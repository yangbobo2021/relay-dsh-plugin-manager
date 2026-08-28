import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginManager, type PluginManagerDependencies } from '../../src/manager.ts'
import { readManagerState, readProfileManifest, writeProfileManifest } from '../../src/profile.ts'
import type { PluginInspection, PluginSource } from '../../src/source.ts'

const PACKAGE = 'example-dsh-plugin'
const VERSION = '1.2.3'
const INSTALL_SPEC = `${PACKAGE}@${VERSION}`

function inspection(version = VERSION): PluginInspection {
  return namedInspection(PACKAGE, version)
}

function namedInspection(
  packageName: string,
  version = VERSION,
  peerDependencies: Record<string, string> = {},
): PluginInspection {
  return {
    source: { kind: 'npm', package: packageName, version },
    sourceType: 'npm',
    requestedSpec: packageName,
    installSpec: `${packageName}@${version}`,
    packageName,
    version,
    integrity: 'sha512-dGVzdA==',
    repository: `github.com/example/${packageName}`,
    description: 'fixture plugin',
    bundlePatch: 'cordis.patch.yml',
    client: false,
    peerDependencies,
  }
}

function materializePlugin(profileDir: string, version = VERSION): void {
  const dir = join(profileDir, 'node_modules', PACKAGE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: PACKAGE,
    version,
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: example-entry\n      name: Example\n')
}

function fixtureSourceName(source: string | PluginSource): string {
  if (typeof source === 'string') return source
  return source.kind === 'npm' ? source.package : source.repo
}

function materializeNamedPlugin(profileDir: string, packageName: string, version = VERSION): void {
  const dir = join(profileDir, 'node_modules', packageName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: packageName,
    version,
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${packageName}-entry\n      name: Example\n`)
}

function addNamedPluginToProfile(profileDir: string, packageName: string, version = VERSION): void {
  materializeNamedPlugin(profileDir, packageName, version)
  const manifest = readProfileManifest(profileDir)
  writeProfileManifest(profileDir, {
    ...manifest,
    dependencies: { ...manifest.dependencies, [packageName]: version },
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles: [...(manifest.dsh?.profile?.bundles ?? []), packageName],
      },
    },
  })
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-plugin-manager-'))
  writeProfileManifest(dir, { dependencies: {}, dsh: { profile: { bundles: [] } } })
  return dir
}

const cleanup: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function manager(
  profileDir: string,
  runPlugin: PluginManagerDependencies['runner']['runPlugin'],
  options: {
    hotActive?: boolean
    hotRestartRequired?: boolean
    dynamicLoader?: boolean
    restartAvailable?: boolean
    inspect?: NonNullable<PluginManagerDependencies['inspect']>
  } = {},
): PluginManager {
  let hotActive = options.hotActive ?? false
  return new PluginManager({
    profileDir,
    searchRuntime: { entries: () => [] },
    runner: { runPlugin },
    inspect: options.inspect ?? vi.fn(async (_source: unknown) => inspection()),
    hot: {
      isActive: () => hotActive,
      activate: vi.fn(async () => {
        if (options.hotRestartRequired === true) {
          return { active: false, restartRequired: true, reason: 'fixture requires restart' }
        }
        hotActive = true
        return { active: true, restartRequired: false, reason: null }
      }),
      deactivate: vi.fn(async () => {
        const wasActive = hotActive
        hotActive = false
        return wasActive
      }),
    },
    restarter: {
      available: () => options.restartAvailable ?? true,
      schedule: () => ({ helperPid: 42, logFile: '/tmp/restart.log' }),
    },
    loader: options.dynamicLoader === true ? {
      entries: () => [{
        id: 'example-entry',
        disabled: (readManagerState(profileDir).disabled[PACKAGE] ?? []).includes('example-entry'),
        fiber: { state: 2 },
      }],
    } : { entries: () => [] },
    hmrTimeoutMs: 20,
  })
}

describe('PluginManager official-command integration', () => {
  it('plans without mutation, then installs exactly once after token confirmation', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const calls: readonly string[][] = []
    const runPlugin = vi.fn(async (_profile: string, args: readonly string[]) => {
      ;(calls as string[][]).push([...args])
      materializePlugin(dir)
      writeProfileManifest(dir, {
        dependencies: { [PACKAGE]: VERSION },
        dsh: { profile: { bundles: [PACKAGE] } },
      })
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runPlugin)

    const plan = await subject.plan({ operation: 'install', source: PACKAGE })
    expect(readProfileManifest(dir).dependencies).toEqual({})
    expect(runPlugin).not.toHaveBeenCalled()

    const started = subject.execute(plan.confirmationToken)
    const completed = await subject.wait(started.id)
    expect(completed.status).toBe('succeeded')
    expect(calls).toEqual([['add', '--save-exact', INSTALL_SPEC]])
    expect(readProfileManifest(dir)).toMatchObject({
      dependencies: { [PACKAGE]: VERSION },
      dsh: { profile: { bundles: [PACKAGE] } },
    })
    expect(completed.result).toMatchObject({ action: 'install', activated: true, restartRequired: false })
    expect(() => subject.execute(plan.confirmationToken)).toThrowError(/already been used/i)
  })

  it('restores the profile manifest when the official install command fails', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const before = readFileSync(join(dir, 'package.json'), 'utf8')
    const subject = manager(dir, async () => {
      writeProfileManifest(dir, { dependencies: { [PACKAGE]: VERSION }, dsh: { profile: { bundles: [] } } })
      return { exitCode: 1, signal: null, stdout: '', stderr: 'pnpm failed', timedOut: false, cancelled: false }
    })

    const plan = await subject.plan({ operation: 'install', source: PACKAGE })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
    expect(completed).toMatchObject({ status: 'failed', error: { code: 'DSH_COMMAND_FAILED' } })
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
  })

  it('refuses a stale plan and rejects a successful CLI result with the wrong installed version', async () => {
    const staleDir = await fixture()
    cleanup.push(staleDir)
    const stale = manager(staleDir, vi.fn(async () => ({
      exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
    })))
    const stalePlan = await stale.plan({ operation: 'install', source: PACKAGE })
    materializePlugin(staleDir)
    writeProfileManifest(staleDir, {
      dependencies: { [PACKAGE]: VERSION }, dsh: { profile: { bundles: [PACKAGE] } },
    })
    expect(() => stale.execute(stalePlan.confirmationToken)).toThrowError(/installed after this plan/i)

    const invalidDir = await fixture()
    cleanup.push(invalidDir)
    const before = readFileSync(join(invalidDir, 'package.json'), 'utf8')
    const invalid = manager(invalidDir, async () => {
      materializePlugin(invalidDir, '9.9.9')
      writeProfileManifest(invalidDir, {
        dependencies: { [PACKAGE]: VERSION }, dsh: { profile: { bundles: [PACKAGE] } },
      })
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const invalidPlan = await invalid.plan({ operation: 'install', source: PACKAGE })
    const completed = await invalid.wait(invalid.execute(invalidPlan.confirmationToken).id)
    expect(completed).toMatchObject({ status: 'failed', error: { code: 'POSTCONDITION_FAILED' } })
    expect(readFileSync(join(invalidDir, 'package.json'), 'utf8')).toBe(before)
  })

  it('reconciles a half-removed package and reports restart for a boot-loaded plugin', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    materializePlugin(dir)
    writeProfileManifest(dir, {
      dependencies: { [PACKAGE]: VERSION },
      dsh: { profile: { bundles: [PACKAGE] } },
    })
    const runPlugin = vi.fn(async () => {
      rmSync(join(dir, 'node_modules', PACKAGE), { recursive: true, force: true })
      return { exitCode: 1, signal: null, stdout: '', stderr: 'lockfile write failed', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runPlugin)

    const plan = await subject.plan({ operation: 'remove', target: PACKAGE })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
    expect(runPlugin).toHaveBeenCalledWith('web', ['remove', PACKAGE], expect.any(AbortSignal), expect.any(Function))
    expect(completed).toMatchObject({
      status: 'succeeded_restart_required',
      result: { action: 'remove', changed: true, restartRequired: true },
    })
    expect(readProfileManifest(dir).dependencies).toEqual({})
    expect(readProfileManifest(dir).dsh?.profile?.bundles).toEqual([])
  })

  it('disables and enables only attributed entries and verifies Loader HMR state', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    materializePlugin(dir)
    writeProfileManifest(dir, {
      dependencies: { [PACKAGE]: VERSION },
      dsh: { profile: { bundles: [PACKAGE] } },
    })
    const subject = manager(dir, async () => ({
      exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
    }), { dynamicLoader: true })

    const disable = await subject.plan({ operation: 'disable', target: PACKAGE })
    expect(disable.impact).toContain('may be interrupted')
    const disabled = await subject.wait(subject.execute(disable.confirmationToken).id)
    expect(disabled).toMatchObject({ status: 'succeeded', result: { restartRequired: false } })
    expect(readManagerState(dir).disabled[PACKAGE]).toEqual(['example-entry'])

    const enable = await subject.plan({ operation: 'enable', target: PACKAGE })
    const enabled = await subject.wait(subject.execute(enable.confirmationToken).id)
    expect(enabled).toMatchObject({
      status: 'succeeded',
      result: { activated: true, restartRequired: false },
    })
    expect(readManagerState(dir).disabled[PACKAGE]).toBeUndefined()
  })

  it('updates through exact add argv and reports the deliberate restart boundary', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    materializePlugin(dir, '1.0.0')
    writeProfileManifest(dir, {
      dependencies: { [PACKAGE]: '1.0.0' },
      dsh: { profile: { bundles: [PACKAGE] } },
    })
    const runPlugin = vi.fn(async () => {
      materializePlugin(dir, VERSION)
      writeProfileManifest(dir, {
        dependencies: { [PACKAGE]: VERSION },
        dsh: { profile: { bundles: [PACKAGE] } },
      })
      return { exitCode: 0, signal: null, stdout: 'updated', stderr: '', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runPlugin)

    const plan = await subject.plan({ operation: 'update', target: PACKAGE })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
    expect(runPlugin).toHaveBeenCalledWith(
      'web', ['add', '--save-exact', INSTALL_SPEC], expect.any(AbortSignal), expect.any(Function),
    )
    expect(completed).toMatchObject({
      status: 'succeeded_restart_required',
      result: { action: 'update', restartRequired: true, activated: false },
    })
  })

  it('disposes a session-hot plugin without requiring restart on removal', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    materializePlugin(dir)
    writeProfileManifest(dir, {
      dependencies: { [PACKAGE]: VERSION },
      dsh: { profile: { bundles: [PACKAGE] } },
    })
    const subject = manager(dir, async () => {
      rmSync(join(dir, 'node_modules', PACKAGE), { recursive: true, force: true })
      writeProfileManifest(dir, { dependencies: {}, dsh: { profile: { bundles: [] } } })
      return { exitCode: 0, signal: null, stdout: 'removed', stderr: '', timedOut: false, cancelled: false }
    }, { hotActive: true })

    const plan = await subject.plan({ operation: 'remove', target: PACKAGE })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
    expect(completed).toMatchObject({
      status: 'succeeded',
      result: { action: 'remove', restartRequired: false, activated: false },
    })
  })

  it('finishes a completed mutation as waiting for manual restart when automatic restart is unavailable', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const subject = manager(dir, async () => {
      materializePlugin(dir)
      writeProfileManifest(dir, {
        dependencies: { [PACKAGE]: VERSION },
        dsh: { profile: { bundles: [PACKAGE] } },
      })
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    }, { hotRestartRequired: true, restartAvailable: false })

    const plan = await subject.plan({ operation: 'install', source: PACKAGE })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
    expect(completed).toMatchObject({
      status: 'waiting_for_manual_restart',
      result: {
        restartRequired: true,
        nextAction: expect.stringContaining('operator workflow'),
      },
    })
  })

  it('A-024/A-025 plans and serially installs three plugins after one confirmation with peer preflight', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const sources = ['plugin-a', 'plugin-b', 'plugin-c']
    const inspect = vi.fn(async (source: string | PluginSource) => {
      const name = fixtureSourceName(source)
      return namedInspection(name, VERSION, name === 'plugin-a'
        ? { 'plugin-workbench': '^1.0.0' }
        : name === 'plugin-c'
          ? { 'plugin-workbench': '~1.2.0' }
          : {})
    })
    const calls: string[][] = []
    let activeRunners = 0
    let maxActiveRunners = 0
    const runPlugin = vi.fn(async (_profile: string, args: readonly string[]) => {
      calls.push([...args])
      activeRunners += 1
      maxActiveRunners = Math.max(maxActiveRunners, activeRunners)
      await Promise.resolve()
      const installSpec = args[2]!
      const packageName = installSpec.slice(0, installSpec.lastIndexOf('@'))
      addNamedPluginToProfile(dir, packageName)
      activeRunners -= 1
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runPlugin, { inspect })

    const plan = await subject.plan({ operation: 'install_many', sources })
    if (plan.action !== 'install_many') throw new Error('expected install_many plan')
    expect(runPlugin).not.toHaveBeenCalled()
    expect(readProfileManifest(dir).dependencies).toEqual({})
    expect(plan.items.map(item => item.installSpec)).toEqual(sources.map(name => `${name}@${VERSION}`))
    expect(plan.missingPeerDependencies).toEqual([{
      packageName: 'plugin-workbench',
      ranges: ['^1.0.0', '~1.2.0'],
      requiredBy: ['plugin-a', 'plugin-c'],
      suggestedSource: 'plugin-workbench',
    }])

    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
    expect(completed).toMatchObject({
      action: 'install_many',
      status: 'succeeded',
      result: {
        action: 'install_many',
        changed: true,
        restartRequired: false,
        items: sources.map(packageName => ({ packageName, status: 'succeeded' })),
      },
    })
    expect(calls).toEqual(sources.map(name => ['add', '--save-exact', `${name}@${VERSION}`]))
    expect(maxActiveRunners).toBe(1)
    expect(readProfileManifest(dir).dependencies).toMatchObject(Object.fromEntries(
      sources.map(name => [name, VERSION]),
    ))
    expect(() => subject.execute(plan.confirmationToken)).toThrow(/already been used/i)
  })

  it('A-024/A-025 excludes installed and in-batch peers and rejects invalid inputs before mutation', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    addNamedPluginToProfile(dir, 'installed-workbench')
    const inspect = vi.fn(async (source: string | PluginSource) => {
      const name = fixtureSourceName(source)
      if (name === 'plugin-a') {
        return namedInspection(name, VERSION, {
          'installed-workbench': '^1.0.0',
          'batch-workbench': '^1.0.0',
        })
      }
      if (name === 'alias-a' || name === 'alias-b') return namedInspection('duplicate-plugin')
      return namedInspection(name)
    })
    const runPlugin = vi.fn(async () => ({
      exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
    }))
    const subject = manager(dir, runPlugin, { inspect })

    const plan = await subject.plan({ operation: 'install_many', sources: ['plugin-a', 'batch-workbench'] })
    if (plan.action !== 'install_many') throw new Error('expected install_many plan')
    expect(plan.missingPeerDependencies).toEqual([])
    await expect(subject.plan({ operation: 'install_many' })).rejects.toMatchObject({ code: 'INVALID_BATCH' })
    await expect(subject.plan({ operation: 'install_many', sources: [] })).rejects.toMatchObject({ code: 'INVALID_BATCH' })
    await expect(subject.plan({
      operation: 'install_many',
      sources: Array.from({ length: 21 }, (_, index) => `plugin-${index}`),
    })).rejects.toMatchObject({ code: 'INVALID_BATCH' })
    await expect(subject.plan({ operation: 'install_many', sources: ['alias-a', 'alias-b'] }))
      .rejects.toMatchObject({ code: 'INVALID_BATCH' })
    expect(runPlugin).not.toHaveBeenCalled()
  })

  it('A-024 stops on a failed child, retains outcomes, and skips later installs', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const sources = ['plugin-a', 'plugin-b', 'plugin-c']
    const inspect = vi.fn(async (source: string | PluginSource) => namedInspection(fixtureSourceName(source)))
    const calls: string[] = []
    const runPlugin = vi.fn(async (_profile: string, args: readonly string[]) => {
      const installSpec = args[2]!
      const packageName = installSpec.slice(0, installSpec.lastIndexOf('@'))
      calls.push(packageName)
      if (packageName === 'plugin-b') {
        return { exitCode: 1, signal: null, stdout: '', stderr: 'fixture failure', timedOut: false, cancelled: false }
      }
      addNamedPluginToProfile(dir, packageName)
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runPlugin, { inspect })
    const plan = await subject.plan({ operation: 'install_many', sources })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)

    expect(completed).toMatchObject({
      status: 'failed',
      error: { code: 'BATCH_INSTALL_FAILED' },
      result: {
        changed: true,
        items: [
          { packageName: 'plugin-a', status: 'succeeded' },
          { packageName: 'plugin-b', status: 'failed', error: { code: 'DSH_COMMAND_FAILED' } },
          { packageName: 'plugin-c', status: 'skipped' },
        ],
      },
    })
    expect(calls).toEqual(['plugin-a', 'plugin-b'])
    expect(readProfileManifest(dir).dependencies).toEqual({ 'plugin-a': VERSION })
  })

  it('A-024 leaves the profile unchanged when the first batch child fails', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const inspect = vi.fn(async (source: string | PluginSource) => namedInspection(fixtureSourceName(source)))
    const runner = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: 'first child failed',
      timedOut: false,
      cancelled: false,
    }))
    const subject = manager(dir, runner, { inspect })
    const plan = await subject.plan({ operation: 'install_many', sources: ['plugin-a', 'plugin-b'] })
    const completed = await subject.wait(subject.execute(plan.confirmationToken).id)

    expect(completed).toMatchObject({
      status: 'failed',
      result: {
        changed: false,
        restartRequired: false,
        items: [
          { packageName: 'plugin-a', status: 'failed' },
          { packageName: 'plugin-b', status: 'skipped' },
        ],
      },
    })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(readProfileManifest(dir).dependencies).toEqual({})
  })

  it('A-024 cancels the active child and never starts later batch items', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const inspect = vi.fn(async (source: string | PluginSource) => namedInspection(fixtureSourceName(source)))
    let reportStarted!: () => void
    const started = new Promise<void>(resolve => { reportStarted = resolve })
    const runPlugin = vi.fn(async (
      _profile: string,
      _args: readonly string[],
      signal: AbortSignal,
    ) => await new Promise<{
      exitCode: number
      signal: NodeJS.Signals | null
      stdout: string
      stderr: string
      timedOut: boolean
      cancelled: boolean
    }>(resolve => {
      reportStarted()
      signal.addEventListener('abort', () => resolve({
        exitCode: 1,
        signal: 'SIGTERM',
        stdout: '',
        stderr: 'cancelled',
        timedOut: false,
        cancelled: true,
      }), { once: true })
    }))
    const subject = manager(dir, runPlugin, { inspect })
    const plan = await subject.plan({ operation: 'install_many', sources: ['plugin-a', 'plugin-b', 'plugin-c'] })
    const operation = subject.execute(plan.confirmationToken)
    await started
    subject.cancel(operation.id)
    const completed = await subject.wait(operation.id)

    expect(completed).toMatchObject({
      status: 'cancelled',
      result: {
        items: [
          { packageName: 'plugin-a', status: 'cancelled' },
          { packageName: 'plugin-b', status: 'skipped' },
          { packageName: 'plugin-c', status: 'skipped' },
        ],
      },
    })
    expect(runPlugin).toHaveBeenCalledTimes(1)
    expect(readProfileManifest(dir).dependencies).toEqual({})
  })

  it('A-017 queues separately confirmed operations without a busy failure', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const inspect = vi.fn(async (source: string | PluginSource) => namedInspection(fixtureSourceName(source)))
    let releaseFirst!: () => void
    let reportFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => { reportFirstStarted = resolve })
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    let activeRunners = 0
    let maxActiveRunners = 0
    const calls: string[] = []
    const runner = vi.fn(async (_profile: string, args: readonly string[]) => {
      const installSpec = args[2]!
      const packageName = installSpec.slice(0, installSpec.lastIndexOf('@'))
      calls.push(packageName)
      activeRunners += 1
      maxActiveRunners = Math.max(maxActiveRunners, activeRunners)
      if (packageName === 'plugin-a') {
        reportFirstStarted()
        await firstGate
      }
      addNamedPluginToProfile(dir, packageName)
      activeRunners -= 1
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runner, { inspect })
    const firstPlan = await subject.plan({ operation: 'install', source: 'plugin-a' })
    const secondPlan = await subject.plan({ operation: 'install', source: 'plugin-b' })
    const first = subject.execute(firstPlan.confirmationToken)
    await firstStarted
    const second = subject.execute(secondPlan.confirmationToken)

    expect(subject.operation(second.id)).toMatchObject({ status: 'queued' })
    releaseFirst()
    await expect(subject.wait(first.id)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(subject.wait(second.id)).resolves.toMatchObject({ status: 'succeeded' })
    expect(calls).toEqual(['plugin-a', 'plugin-b'])
    expect(maxActiveRunners).toBe(1)
  })

  it('A-017 rechecks plan freshness when queued work reaches the active slot', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    const inspect = vi.fn(async (source: string | PluginSource) => namedInspection(fixtureSourceName(source)))
    let releaseFirst!: () => void
    let reportFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => { reportFirstStarted = resolve })
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const runner = vi.fn(async () => {
      reportFirstStarted()
      await firstGate
      addNamedPluginToProfile(dir, 'plugin-a')
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const subject = manager(dir, runner, { inspect })
    const firstPlan = await subject.plan({ operation: 'install', source: 'plugin-a' })
    const queuedPlan = await subject.plan({ operation: 'install', source: 'plugin-a' })
    const first = subject.execute(firstPlan.confirmationToken)
    await firstStarted
    const queued = subject.execute(queuedPlan.confirmationToken)
    releaseFirst()

    await expect(subject.wait(first.id)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(subject.wait(queued.id)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'PLAN_STALE' },
    })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('A-024/A-025 rejects aggregate stale state and reports restart-aware parent and child states', async () => {
    const staleDir = await fixture()
    cleanup.push(staleDir)
    const inspect = vi.fn(async (source: string | PluginSource) => namedInspection(fixtureSourceName(source)))
    const staleRunner = vi.fn(async () => ({
      exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
    }))
    const stale = manager(staleDir, staleRunner, { inspect })
    const stalePlan = await stale.plan({ operation: 'install_many', sources: ['plugin-a', 'plugin-b'] })
    addNamedPluginToProfile(staleDir, 'plugin-b')
    expect(() => stale.execute(stalePlan.confirmationToken)).toThrow(/installed after this plan/i)
    expect(staleRunner).not.toHaveBeenCalled()

    for (const [restartAvailable, expected] of [
      [true, 'succeeded_restart_required'],
      [false, 'waiting_for_manual_restart'],
    ] as const) {
      const dir = await fixture()
      cleanup.push(dir)
      const runner = vi.fn(async (_profile: string, args: readonly string[]) => {
        const installSpec = args[2]!
        addNamedPluginToProfile(dir, installSpec.slice(0, installSpec.lastIndexOf('@')))
        return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
      })
      const subject = manager(dir, runner, {
        hotRestartRequired: true,
        restartAvailable,
        inspect,
      })
      const plan = await subject.plan({ operation: 'install_many', sources: ['plugin-a', 'plugin-b'] })
      const completed = await subject.wait(subject.execute(plan.confirmationToken).id)
      expect(completed).toMatchObject({
        status: expected,
        result: {
          restartRequired: true,
          nextAction: expect.any(String),
          items: [{ status: expected }, { status: expected }],
        },
      })
    }
  })

  it('refuses unsafe enablement projections and keeps restart separately planned', async () => {
    const dir = await fixture()
    cleanup.push(dir)
    materializePlugin(dir)
    writeFileSync(join(dir, 'node_modules', PACKAGE, 'cordis.patch.yml'), '- insert:\n    - id: tools\n      name: fixture\n')
    writeProfileManifest(dir, {
      dependencies: { [PACKAGE]: VERSION }, dsh: { profile: { bundles: [PACKAGE] } },
    })
    const subject = manager(dir, async () => ({
      exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
    }))
    await expect(subject.plan({ operation: 'disable', target: PACKAGE })).rejects.toMatchObject({
      code: 'PROTECTED_PLUGIN',
    })

    writeFileSync(join(dir, 'node_modules', PACKAGE, 'package.json'), JSON.stringify({
      name: PACKAGE, version: VERSION, dsh: { client: {} },
    }))
    await expect(subject.plan({ operation: 'enable', target: PACKAGE })).rejects.toMatchObject({
      code: 'ENABLEMENT_UNSUPPORTED',
    })

    const restart = await subject.plan({ operation: 'restart' })
    expect(restart).toMatchObject({ action: 'restart', restartExpected: true })
    const completed = await subject.wait(subject.execute(restart.confirmationToken).id)
    expect(completed).toMatchObject({
      status: 'succeeded', result: { action: 'restart', restartRequired: false },
    })

    const unavailable = manager(dir, async () => ({
      exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
    }), { restartAvailable: false })
    await expect(unavailable.plan({ operation: 'restart' })).rejects.toMatchObject({
      code: 'RESTART_UNAVAILABLE',
    })
  })
})
