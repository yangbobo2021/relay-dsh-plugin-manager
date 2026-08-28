import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginSearchRuntime } from './search-runtime.ts'
import { searchPlugins, type SearchOptions, type SearchResult } from './search.ts'
import {
  inspectPluginSource,
  NPM_NAME,
  parseGithubSpec,
  parseNpmSpec,
  renderSource,
  type FetchOptions,
  type PluginInspection,
} from './source.ts'
import {
  disablePackage,
  enablePackage,
  listPluginStatuses,
  packageSurface,
  profileManifestText,
  readProfileManifest,
  reconcileRemovedPackage,
  restoreProfileManifest,
  type LoaderEntrySnapshot,
  type PackageSurface,
  type PluginStatus,
} from './profile.ts'
import {
  PlanStore,
  type ConfirmationPlan,
  type InstallPlanItem,
  type MissingPeerDependency,
  type MutationAction,
  type PlanAction,
} from './plans.ts'
import {
  OperationTracker,
  type OperationCompletion,
  type OperationContext,
  type OperationSnapshot,
} from './operations.ts'
import type { DshCliRunner, RunnerResult } from './runner.ts'
import type { HotRuntime, HotActivationResult } from './hot-runtime.ts'
import type { DshRestarter } from './restart.ts'
import { fail } from './errors.ts'

interface LoaderEntryLike {
  id?: string
  disabled?: boolean
  options?: { id?: string; name?: string }
  fiber?: { state?: number | string }
}

interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
}

export interface PluginManagerDependencies {
  profileDir: string
  searchRuntime: Pick<PluginSearchRuntime, 'entries'>
  runner: Pick<DshCliRunner, 'runPlugin'>
  hot: Pick<HotRuntime, 'activate' | 'deactivate' | 'isActive'>
  restarter: Pick<DshRestarter, 'available' | 'schedule'>
  loader?: LoaderLike
  inspect?: typeof inspectPluginSource
  plans?: PlanStore
  operations?: OperationTracker
  fetchOptions?: Omit<FetchOptions, 'signal'>
  hmrTimeoutMs?: number
}

export interface DiscoverRequest {
  action: 'list' | 'search' | 'inspect' | 'status'
  query?: string
  target?: string
  operationId?: string
  maxResults?: number
}

export interface PlanRequest {
  operation: PlanAction
  target?: string
  source?: string
  sources?: string[]
}

export interface MutationResult {
  action: MutationAction
  packageName?: string
  installSpec?: string
  changed: boolean
  activated?: boolean
  restartRequired: boolean
  reason?: string
  nextAction?: string
  command?: { exitCode: number; stdout: string; stderr: string }
  restart?: { helperPid: number | undefined; logFile: string }
}

export type InstallManyItemStatus =
  | 'succeeded'
  | 'succeeded_restart_required'
  | 'waiting_for_manual_restart'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface InstallManyItemResult {
  packageName: string
  installSpec: string
  status: InstallManyItemStatus
  result?: MutationResult
  error?: { code?: string; message: string }
}

export interface InstallManyResult {
  action: 'install_many'
  changed: boolean
  restartRequired: boolean
  nextAction?: string
  items: InstallManyItemResult[]
}

const MAX_INSTALL_MANY_SOURCES = 20

const FIBER_PHASE: Record<number, string | null> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

const PROTECTED_ENTRY_IDS = new Set([
  'relay-plugin-search-runtime',
  'relay-plugin-manager-host',
  'commands',
  'tools',
  'webserver',
  'web-runtime',
])

function safePackageName(value: string | undefined): string {
  const name = value?.trim() ?? ''
  if (!NPM_NAME.test(name)) fail('INVALID_NPM_SPEC', 'A valid installed package name is required.')
  return name
}

function commandResult(result: RunnerResult): MutationResult['command'] {
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

function operationError(error: unknown): { code?: string; message: string } {
  return {
    ...typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? { code: error.code }
      : {},
    message: error instanceof Error ? error.message : String(error),
  }
}

function installedPackageManifest(profileDir: string, packageName: string): { name?: unknown; version?: unknown } | null {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
  } catch {
    return null
  }
}

function installedSourceMatches(packageName: string, dependency: string, installSpec: string): boolean {
  const github = parseGithubSpec(installSpec, true)
  if (github !== null) return dependency === installSpec
  const npm = parseNpmSpec(installSpec, true)
  return npm.package === packageName && dependency === npm.version
}

export class PluginManager {
  private readonly profileDir: string
  private readonly searchRuntime: PluginManagerDependencies['searchRuntime']
  private readonly runner: PluginManagerDependencies['runner']
  private readonly hot: PluginManagerDependencies['hot']
  private readonly restarter: PluginManagerDependencies['restarter']
  private readonly loader?: LoaderLike
  private readonly inspect: typeof inspectPluginSource
  private readonly plans: PlanStore
  private readonly operations: OperationTracker
  private readonly fetchOptions: Omit<FetchOptions, 'signal'>
  private readonly hmrTimeoutMs: number

  constructor(dependencies: PluginManagerDependencies) {
    this.profileDir = dependencies.profileDir
    this.searchRuntime = dependencies.searchRuntime
    this.runner = dependencies.runner
    this.hot = dependencies.hot
    this.restarter = dependencies.restarter
    this.loader = dependencies.loader
    this.inspect = dependencies.inspect ?? inspectPluginSource
    this.plans = dependencies.plans ?? new PlanStore()
    this.operations = dependencies.operations ?? new OperationTracker()
    this.fetchOptions = dependencies.fetchOptions ?? {}
    this.hmrTimeoutMs = dependencies.hmrTimeoutMs ?? 5_000
  }

  private loaderEntries(): LoaderEntrySnapshot[] {
    if (this.loader === undefined) return []
    return [...this.loader.entries()].flatMap((entry) => {
      const id = entry.options?.id ?? entry.id
      if (id === undefined || id === '') return []
      const rawPhase = entry.fiber?.state
      const phase = typeof rawPhase === 'number' ? (FIBER_PHASE[rawPhase] ?? 'unknown') : rawPhase ?? null
      return [{
        id,
        ...(entry.options?.name === undefined ? {} : { name: entry.options.name }),
        disabled: entry.disabled === true,
        phase,
      }]
    })
  }

  list(): PluginStatus[] {
    return listPluginStatuses(this.profileDir, this.loaderEntries())
  }

  async discover(request: DiscoverRequest, signal?: AbortSignal): Promise<unknown> {
    if (request.action === 'list') return { profile: 'web', plugins: this.list() }
    if (request.action === 'search') {
      const options: SearchOptions = {
        ...this.fetchOptions,
        signal,
        maxResults: request.maxResults,
        inspect: this.inspect,
      }
      return await searchPlugins(this.searchRuntime, request.query ?? '', options)
    }
    if (request.action === 'inspect') {
      if (request.target === undefined) fail('INVALID_SOURCE', 'A plugin source is required for inspection.')
      return await this.inspect(request.target, { ...this.fetchOptions, signal })
    }
    if (request.operationId !== undefined) return this.operations.get(request.operationId)
    if (request.target === undefined) return { profile: 'web', plugins: this.list() }
    const name = safePackageName(request.target)
    const status = this.list().find(plugin => plugin.packageName === name)
    if (status === undefined) fail('PLUGIN_NOT_INSTALLED', `${name} is not installed in the web profile.`)
    return status
  }

  private installed(name: string): { source: string; surface: PackageSurface } {
    const source = readProfileManifest(this.profileDir).dependencies?.[name]
    if (source === undefined) fail('PLUGIN_NOT_INSTALLED', `${name} is not installed in the web profile.`)
    return { source, surface: packageSurface(this.profileDir, name, source) }
  }

  private assertEnablementAllowed(surface: PackageSurface): void {
    if (surface.entryIds?.some(id => PROTECTED_ENTRY_IDS.has(id)) === true) {
      fail('PROTECTED_PLUGIN', `${surface.packageName} owns protected DSH infrastructure and cannot be toggled.`)
    }
  }

  private async updateInspection(name: string, sourceOverride: string | undefined, signal?: AbortSignal): Promise<PluginInspection> {
    if (sourceOverride !== undefined) {
      const inspection = await this.inspect(sourceOverride, { ...this.fetchOptions, signal })
      if (inspection.packageName !== name) fail('PACKAGE_NAME_MISMATCH', 'Update source resolves to a different package name.')
      return inspection
    }
    const current = this.installed(name).source
    const github = parseGithubSpec(current)
    const source = github === null
      ? name
      : renderSource({ kind: 'github', owner: github.owner, repo: github.repo })
    return await this.inspect(source, { ...this.fetchOptions, signal })
  }

  async plan(request: PlanRequest, signal?: AbortSignal): Promise<ConfirmationPlan> {
    if (request.operation === 'install_many') return await this.planInstallMany(request.sources, signal)
    if (request.operation === 'restart') {
      if (!this.restarter.available()) fail('RESTART_UNAVAILABLE', 'Automatic restart is unavailable in this deployment.')
      return this.plans.create({
        action: 'restart', profile: 'web', impact: 'Restart the running DSH process.', restartExpected: true,
      })
    }
    if (request.operation === 'install') {
      const source = request.source ?? request.target
      if (source === undefined) fail('INVALID_SOURCE', 'Install requires an npm or GitHub source.')
      const inspection = await this.inspect(source, { ...this.fetchOptions, signal })
      if (readProfileManifest(this.profileDir).dependencies?.[inspection.packageName] !== undefined) {
        fail('PLUGIN_ALREADY_INSTALLED', `${inspection.packageName} is already installed; use update.`)
      }
      return this.plans.create({
        action: 'install', profile: 'web', packageName: inspection.packageName,
        installSpec: inspection.installSpec,
        impact: `Install ${inspection.packageName} from ${inspection.installSpec}.`,
        restartExpected: inspection.bundlePatch !== null,
      })
    }
    const name = safePackageName(request.target)
    const installed = this.installed(name)
    if (request.operation === 'update') {
      const inspection = await this.updateInspection(name, request.source, signal)
      return this.plans.create({
        action: 'update', profile: 'web', packageName: name, currentSource: installed.source,
        installSpec: inspection.installSpec,
        impact: `Update ${name} from ${installed.source} to ${inspection.installSpec}.`,
        restartExpected: true,
      })
    }
    if (request.operation === 'enable' || request.operation === 'disable') {
      this.assertEnablementAllowed(installed.surface)
      if (installed.surface.entryIds === null) {
        fail('ENABLEMENT_UNSUPPORTED', `${name} has no safely attributable Loader entries.`)
      }
    }
    return this.plans.create({
      action: request.operation,
      profile: 'web',
      packageName: name,
      currentSource: installed.source,
      impact: request.operation === 'disable'
        ? `Disable ${name}. Conversations currently using capabilities from this plugin may be interrupted; confirm from another backend or session when continuity matters.`
        : `${request.operation[0]!.toUpperCase()}${request.operation.slice(1)} ${name}.`,
      restartExpected: request.operation === 'remove',
    })
  }

  private async planInstallMany(sources: string[] | undefined, signal?: AbortSignal): Promise<ConfirmationPlan> {
    if (sources === undefined || sources.length === 0 || sources.length > MAX_INSTALL_MANY_SOURCES) {
      fail('INVALID_BATCH', `Multi-install requires between 1 and ${MAX_INSTALL_MANY_SOURCES} sources.`)
    }
    const inspections = await Promise.all(sources.map(source => this.inspect(source, { ...this.fetchOptions, signal })))
    const profileDependencies = readProfileManifest(this.profileDir).dependencies ?? {}
    const requestedPackages = new Set<string>()
    for (const inspection of inspections) {
      if (requestedPackages.has(inspection.packageName)) {
        fail('INVALID_BATCH', `Multi-install resolves more than one source to ${inspection.packageName}.`)
      }
      if (profileDependencies[inspection.packageName] !== undefined) {
        fail('PLUGIN_ALREADY_INSTALLED', `${inspection.packageName} is already installed; use update.`)
      }
      requestedPackages.add(inspection.packageName)
    }

    const missing = new Map<string, { ranges: Set<string>; requiredBy: Set<string> }>()
    for (const inspection of inspections) {
      for (const [packageName, range] of Object.entries(inspection.peerDependencies)) {
        if (profileDependencies[packageName] !== undefined || requestedPackages.has(packageName)) continue
        const entry = missing.get(packageName) ?? { ranges: new Set<string>(), requiredBy: new Set<string>() }
        entry.ranges.add(range)
        entry.requiredBy.add(inspection.packageName)
        missing.set(packageName, entry)
      }
    }
    const missingPeerDependencies: MissingPeerDependency[] = [...missing]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageName, entry]) => ({
        packageName,
        ranges: [...entry.ranges].sort(),
        requiredBy: [...entry.requiredBy].sort(),
        suggestedSource: packageName,
      }))
    const items: InstallPlanItem[] = inspections.map(inspection => ({
      action: 'install',
      packageName: inspection.packageName,
      installSpec: inspection.installSpec,
      impact: `Install ${inspection.packageName} from ${inspection.installSpec}.`,
      restartExpected: inspection.bundlePatch !== null,
    }))
    return this.plans.create({
      action: 'install_many',
      profile: 'web',
      items,
      missingPeerDependencies,
      impact: `Install ${items.length} plugins serially: ${items.map(item => item.packageName).join(', ')}.`,
      restartExpected: items.some(item => item.restartExpected),
    })
  }

  execute(confirmationToken: string): OperationSnapshot {
    const plan = this.plans.consume(confirmationToken)
    this.assertPlanFresh(plan)
    if (plan.action === 'install_many') {
      const automaticRestartAvailable = this.restarter.available()
      return this.operations.start(
        'install_many',
        `${plan.items.length} plugins`,
        async context => {
          this.assertPlanFresh(plan)
          return await this.installMany(plan.items, context, automaticRestartAvailable)
        },
        result => this.batchCompletion(result, automaticRestartAvailable),
      )
    }
    const target = plan.packageName ?? 'dsh'
    const automaticRestartAvailable = this.restarter.available()
    return this.operations.start(plan.action, target, async context => {
      this.assertPlanFresh(plan)
      if (plan.action === 'restart') {
        context.progress('scheduling restart')
        const restart = this.restarter.schedule()
        return { action: 'restart', changed: true, restartRequired: false, restart } satisfies MutationResult
      }
      if (plan.packageName === undefined) fail('POSTCONDITION_FAILED', 'Mutation plan has no package name.')
      if (plan.action === 'install' || plan.action === 'update') {
        if (plan.installSpec === undefined) fail('POSTCONDITION_FAILED', 'Install/update plan has no immutable source.')
        return this.withRestartGuidance(
          await this.installOrUpdate(plan.action, plan.packageName, plan.installSpec, context),
          automaticRestartAvailable,
        )
      }
      if (plan.action === 'remove') {
        return this.withRestartGuidance(await this.remove(plan.packageName, context), automaticRestartAvailable)
      }
      return this.withRestartGuidance(await this.toggle(plan.action, plan.packageName, context), automaticRestartAvailable)
    }, result => this.mutationCompletion(result, automaticRestartAvailable))
  }

  private assertPlanFresh(plan: ConfirmationPlan): void {
    const dependencies = readProfileManifest(this.profileDir).dependencies ?? {}
    if (plan.action === 'install_many') {
      for (const item of plan.items) {
        if (dependencies[item.packageName] !== undefined) {
          fail('PLAN_STALE', `${item.packageName} was installed after this plan was created; create a new plan.`)
        }
      }
      return
    }
    if (plan.action === 'install' && plan.packageName !== undefined && dependencies[plan.packageName] !== undefined) {
      fail('PLAN_STALE', `${plan.packageName} was installed after this plan was created; create a new plan.`)
    }
    if (plan.action !== 'install' && plan.action !== 'restart' && plan.packageName !== undefined
      && dependencies[plan.packageName] !== plan.currentSource) {
      fail('PLAN_STALE', `${plan.packageName} changed after this plan was created; create a new plan.`)
    }
  }

  private withRestartGuidance<Result extends { restartRequired: boolean; nextAction?: string }>(
    result: Result,
    automaticRestartAvailable: boolean,
  ): Result {
    if (!result.restartRequired) return result
    return {
      ...result,
      nextAction: automaticRestartAvailable
        ? 'Plan and confirm a separate DSH restart to activate this change.'
        : 'Restart DSH through the deployment supervisor or operator workflow to activate this change.',
    }
  }

  private mutationCompletion(
    result: { restartRequired: boolean },
    automaticRestartAvailable: boolean,
  ): { status: 'succeeded' | 'succeeded_restart_required' | 'waiting_for_manual_restart' } {
    if (!result.restartRequired) return { status: 'succeeded' }
    return { status: automaticRestartAvailable ? 'succeeded_restart_required' : 'waiting_for_manual_restart' }
  }

  private async installMany(
    items: readonly InstallPlanItem[],
    context: OperationContext,
    automaticRestartAvailable: boolean,
  ): Promise<InstallManyResult> {
    const results: InstallManyItemResult[] = []
    const skipRemaining = (start: number): void => {
      for (const item of items.slice(start)) {
        results.push({
          packageName: item.packageName,
          installSpec: item.installSpec,
          status: 'skipped',
          error: { message: 'Skipped because an earlier batch item did not complete.' },
        })
      }
    }

    for (const [index, item] of items.entries()) {
      if (context.signal.aborted) {
        results.push({
          packageName: item.packageName,
          installSpec: item.installSpec,
          status: 'cancelled',
          error: { message: 'Batch cancelled before this item started.' },
        })
        skipRemaining(index + 1)
        break
      }
      context.progress(`install_many: ${index + 1}/${items.length} installing ${item.packageName}`)
      try {
        const result = this.withRestartGuidance(
          await this.installOrUpdate('install', item.packageName, item.installSpec, context),
          automaticRestartAvailable,
        )
        results.push({
          packageName: item.packageName,
          installSpec: item.installSpec,
          status: this.mutationCompletion(result, automaticRestartAvailable).status,
          result,
        })
      } catch (error) {
        results.push({
          packageName: item.packageName,
          installSpec: item.installSpec,
          status: context.signal.aborted ? 'cancelled' : 'failed',
          error: operationError(error),
        })
        skipRemaining(index + 1)
        break
      }
    }
    const result: InstallManyResult = {
      action: 'install_many',
      changed: results.some(item => item.result?.changed === true),
      restartRequired: results.some(item => item.result?.restartRequired === true),
      items: results,
    }
    return this.withRestartGuidance(result, automaticRestartAvailable)
  }

  private batchCompletion(
    result: InstallManyResult,
    automaticRestartAvailable: boolean,
  ): OperationCompletion {
    const failed = result.items.find(item => item.status === 'failed')
    if (failed !== undefined) {
      return {
        status: 'failed',
        progress: `failed at ${failed.packageName}`,
        error: {
          code: 'BATCH_INSTALL_FAILED',
          message: `${failed.packageName} failed: ${failed.error?.message ?? 'unknown error'}`,
        },
      }
    }
    return this.mutationCompletion(result, automaticRestartAvailable)
  }

  operation(id: string): OperationSnapshot {
    return this.operations.get(id)
  }

  cancel(id: string): OperationSnapshot {
    return this.operations.cancel(id)
  }

  wait(id: string): Promise<OperationSnapshot> {
    return this.operations.wait(id)
  }

  private async installOrUpdate(
    action: 'install' | 'update',
    packageName: string,
    installSpec: string,
    context: { signal: AbortSignal; progress(message: string): void },
  ): Promise<MutationResult> {
    const before = profileManifestText(this.profileDir)
    context.progress(`${action}: running official DSH plugin command`)
    const result = await this.runner.runPlugin('web', ['add', '--save-exact', installSpec], context.signal, context.progress)
    if (result.exitCode !== 0 || result.timedOut || result.cancelled) {
      restoreProfileManifest(this.profileDir, before)
      fail('DSH_COMMAND_FAILED', `Official DSH plugin command failed with exit code ${result.exitCode}.`, commandResult(result))
    }
    const manifest = readProfileManifest(this.profileDir)
    const dependency = manifest.dependencies?.[packageName]
    const surface = dependency === undefined ? null : packageSurface(this.profileDir, packageName, dependency)
    const installedManifest = installedPackageManifest(this.profileDir, packageName)
    const bundleCount = manifest.dsh?.profile?.bundles?.filter(name => name === packageName).length ?? 0
    const validSurface = surface !== null && (surface.bundle || surface.client)
    const validBundleMembership = surface !== null && (surface.bundle ? bundleCount === 1 : bundleCount === 0)
    const validIdentity = installedManifest?.name === packageName
    const validSource = dependency !== undefined && installedSourceMatches(packageName, dependency, installSpec)
    const npmSource = parseGithubSpec(installSpec, true) === null ? parseNpmSpec(installSpec, true) : null
    const validVersion = npmSource === null || installedManifest?.version === npmSource.version
    if (!validSource || !validSurface || !validBundleMembership || !validIdentity || !validVersion) {
      restoreProfileManifest(this.profileDir, before)
      fail('POSTCONDITION_FAILED', `Official command completed but ${packageName} did not satisfy profile postconditions.`)
    }
    let activation: HotActivationResult
    if (action === 'update') {
      activation = { active: false, restartRequired: true, reason: 'Updated bundles activate after DSH restart.' }
    } else {
      context.progress('install: attempting restart-free activation')
      activation = await this.hot.activate(surface)
    }
    return {
      action,
      packageName,
      installSpec,
      changed: true,
      activated: activation.active,
      restartRequired: activation.restartRequired,
      ...(activation.reason === null ? {} : { reason: activation.reason }),
      command: commandResult(result),
    }
  }

  private async remove(
    packageName: string,
    context: { signal: AbortSignal; progress(message: string): void },
  ): Promise<MutationResult> {
    this.installed(packageName)
    const before = profileManifestText(this.profileDir)
    const wasHot = this.hot.isActive(packageName)
    context.progress('remove: running official DSH plugin command')
    const result = await this.runner.runPlugin('web', ['remove', packageName], context.signal, context.progress)
    const packageExists = existsSync(join(this.profileDir, 'node_modules', packageName, 'package.json'))
    if (result.exitCode !== 0 || result.timedOut || result.cancelled) {
      if (!result.cancelled && !packageExists) reconcileRemovedPackage(this.profileDir, packageName)
      else restoreProfileManifest(this.profileDir, before)
      if (packageExists || result.cancelled) {
        fail('DSH_COMMAND_FAILED', `Official DSH plugin remove failed with exit code ${result.exitCode}.`, commandResult(result))
      }
    }
    const manifest = readProfileManifest(this.profileDir)
    const remains = manifest.dependencies?.[packageName] !== undefined
      || manifest.dsh?.profile?.bundles?.includes(packageName) === true
    if (remains) fail('POSTCONDITION_FAILED', `${packageName} remains in the profile after removal.`)
    const deactivated = wasHot ? await this.hot.deactivate(packageName) : false
    return {
      action: 'remove',
      packageName,
      changed: true,
      activated: false,
      restartRequired: !deactivated,
      ...deactivated ? {} : { reason: 'A boot-loaded plugin remains in the current process until DSH restarts.' },
      command: commandResult(result),
    }
  }

  private async toggle(
    action: 'enable' | 'disable',
    packageName: string,
    context: { signal: AbortSignal; progress(message: string): void },
  ): Promise<MutationResult> {
    const { surface } = this.installed(packageName)
    this.assertEnablementAllowed(surface)
    context.progress(`${action}: updating profile patch`)
    const ids = action === 'disable' ? disablePackage(this.profileDir, surface) : enablePackage(this.profileDir, surface)
    if (action === 'disable' && this.hot.isActive(packageName)) await this.hot.deactivate(packageName)
    if (action === 'enable' && !this.loaderEntries().some(entry => surface.entryIds?.includes(entry.id))) {
      const activation = await this.hot.activate(surface)
      return {
        action, packageName, changed: ids.length > 0, activated: activation.active,
        restartRequired: activation.restartRequired,
        ...(activation.reason === null ? {} : { reason: activation.reason }),
      }
    }
    const expectedDisabled = action === 'disable'
    const deadline = Date.now() + this.hmrTimeoutMs
    let verified = false
    while (Date.now() < deadline && !context.signal.aborted) {
      const relevant = this.loaderEntries().filter(entry => surface.entryIds?.includes(entry.id))
      if (relevant.length > 0 && relevant.every(entry => entry.disabled === expectedDisabled)) {
        verified = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return {
      action,
      packageName,
      changed: ids.length > 0,
      activated: action === 'enable' && verified,
      restartRequired: !verified,
      ...verified ? {} : { reason: 'Loader HMR state could not be verified; restart is required.' },
    }
  }
}

export type { SearchResult }
