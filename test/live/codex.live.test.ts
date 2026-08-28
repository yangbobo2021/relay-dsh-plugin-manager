import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { PluginManager } from '../../src/manager.ts'
import { readManagerState, readProfileManifest } from '../../src/profile.ts'
import { githubSearchProvider, npmSearchProvider } from '../../src/providers.ts'
import { DshCliRunner } from '../../src/runner.ts'
import PluginSearchRuntime from '../../src/search-runtime.ts'
import type { SearchResult } from '../../src/search.ts'
import type { PluginInspection } from '../../src/source.ts'

const PACKAGE = 'relay-dsh-plugin-codex'
const REPOSITORY = 'github:yangbobo2021/relay-dsh-plugin-codex'
const BATCH_PACKAGES = [
  PACKAGE,
  'relay-dsh-plugin-files',
  'relay-dsh-plugin-terminal',
] as const
const live = process.env.RELAY_LIVE_PLUGIN_ACCEPTANCE === '1'
const root = resolve(import.meta.dirname, '..', '..')
const upstream = process.env.DSH_UPSTREAM_DIR === undefined
  ? resolve(root, '..', '..', 'upstream', 'deepseek-harness')
  : resolve(process.env.DSH_UPSTREAM_DIR)
const officialCli = process.env.DSH_CLI_PATH === undefined
  ? resolve(upstream, 'apps', 'cli', 'lib', 'bin.js')
  : resolve(process.env.DSH_CLI_PATH)

interface LiveFixture {
  home: string
  profileDir: string
  manager: PluginManager
}

async function liveFixture(searchRuntime: PluginSearchRuntime): Promise<LiveFixture> {
  const home = await mkdtemp(resolve(tmpdir(), 'relay-plugin-manager-live-'))
  const profileDir = resolve(home, 'profiles', 'web')
  const env = { ...process.env, DSH_HOME: home }
  const manager = new PluginManager({
    profileDir,
    searchRuntime,
    runner: new DshCliRunner({
      env,
      argv: ['node', officialCli],
      execPath: process.execPath,
      cwd: root,
      timeoutMs: 180_000,
    }),
    hot: {
      activate: async () => ({
        active: false,
        restartRequired: true,
        reason: 'Live acceptance intentionally runs outside the booted profile process.',
      }),
      deactivate: async () => false,
      isActive: () => false,
    },
    restarter: { available: () => false, schedule: () => { throw new Error('not available') } },
    hmrTimeoutMs: 20,
  })
  return { home, profileDir, manager }
}

async function executePlan(manager: PluginManager, request: Parameters<PluginManager['plan']>[0]) {
  const plan = await manager.plan(request)
  const completed = await manager.wait(manager.execute(plan.confirmationToken).id)
  const result = completed.result as { restartRequired?: boolean } | undefined
  expect(completed.status, JSON.stringify(completed.error)).toBe(
    result?.restartRequired === true ? 'waiting_for_manual_restart' : 'succeeded',
  )
  return { plan, completed }
}

async function bootWebProfile(home: string): Promise<{ url: string; status: number }> {
  const child = spawn(process.execPath, [officialCli, 'web', '--no-open', '--port', '0'], {
    cwd: home,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'keyless-live-plugin-acceptance',
      DSH_HOME: home,
      DSH_AGENTS_HOME: resolve(home, 'agents'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const ready = new Promise<string>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`DSH web readiness timed out.\n${output}`)), 45_000)
    const inspect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-64 * 1024)
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`DSH web exited before readiness (code=${String(code)}, signal=${String(signal)}).\n${output}`))
    })
  })
  try {
    const url = await ready
    const response = await fetch(url)
    return { url, status: response.status }
  } finally {
    await stopChild(child)
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>(resolveClose => child.once('close', () => resolveClose()))
  child.kill('SIGTERM')
  await closed
}

describe.skipIf(!live)('real relay-dsh-plugin-codex acceptance', () => {
  it('searches, inspects, installs, toggles, updates, and removes npm and GitHub sources', async () => {
    expect(existsSync(officialCli)).toBe(true)
    const ctx = new Context()
    await ctx.plugin(PluginSearchRuntime)
    ctx.pluginSearch.register(npmSearchProvider())
    ctx.pluginSearch.register(githubSearchProvider())
    const homes: string[] = []
    try {
      const discovery = await new PluginManager({
        profileDir: resolve(tmpdir(), 'unused-relay-plugin-profile'),
        searchRuntime: ctx.pluginSearch,
        runner: { runPlugin: async () => { throw new Error('read-only discovery cannot mutate') } },
        hot: { activate: async () => { throw new Error('not used') }, deactivate: async () => false, isActive: () => false },
        restarter: { available: () => false, schedule: () => { throw new Error('not used') } },
      }).discover({ action: 'search', query: PACKAGE, maxResults: 3 }) as SearchResult
      const candidate = discovery.candidates.find(item => item.packageName === PACKAGE)
      expect(candidate).toBeDefined()
      expect(candidate?.recommendedSource).toMatch(/^relay-dsh-plugin-codex@\d+\.\d+\.\d+/u)
      expect(new Set(candidate?.sources.flatMap(source => source.providers))).toEqual(new Set(['github', 'npm']))

      const npmInspection = await new PluginManager({
        profileDir: resolve(tmpdir(), 'unused-relay-plugin-profile'),
        searchRuntime: ctx.pluginSearch,
        runner: { runPlugin: async () => { throw new Error('read-only inspection cannot mutate') } },
        hot: { activate: async () => { throw new Error('not used') }, deactivate: async () => false, isActive: () => false },
        restarter: { available: () => false, schedule: () => { throw new Error('not used') } },
      }).discover({ action: 'inspect', target: PACKAGE }) as PluginInspection
      expect(npmInspection).toMatchObject({ packageName: PACKAGE, sourceType: 'npm', bundlePatch: './cordis.patch.yml' })
      expect(npmInspection.version).toMatch(/^\d+\.\d+\.\d+/u)
      expect(npmInspection.integrity).toMatch(/^sha512-/u)

      const githubInspection = await new PluginManager({
        profileDir: resolve(tmpdir(), 'unused-relay-plugin-profile'),
        searchRuntime: ctx.pluginSearch,
        runner: { runPlugin: async () => { throw new Error('read-only inspection cannot mutate') } },
        hot: { activate: async () => { throw new Error('not used') }, deactivate: async () => false, isActive: () => false },
        restarter: { available: () => false, schedule: () => { throw new Error('not used') } },
      }).discover({ action: 'inspect', target: REPOSITORY }) as PluginInspection
      expect(githubInspection).toMatchObject({ packageName: PACKAGE, sourceType: 'github', bundlePatch: './cordis.patch.yml' })
      expect(githubInspection.commit).toMatch(/^[a-f0-9]{40}$/u)

      const npm = await liveFixture(ctx.pluginSearch)
      homes.push(npm.home)
      const npmInstall = await executePlan(npm.manager, { operation: 'install', source: PACKAGE })
      expect(npmInstall.plan.installSpec).toBe(npmInspection.installSpec)
      expect(npmInstall.completed.result).toMatchObject({ packageName: PACKAGE, restartRequired: true })
      expect(readProfileManifest(npm.profileDir)).toMatchObject({
        dependencies: { [PACKAGE]: npmInspection.version },
        dsh: { profile: { bundles: expect.arrayContaining([PACKAGE]) } },
      })
      expect(npm.manager.list().find(item => item.packageName === PACKAGE)).toMatchObject({
        bundle: true, enablement: 'enabled', restartRequired: true,
      })
      const dump = execFileSync(process.execPath, [officialCli, '--profile', 'web', '--dump-config'], {
        env: { ...process.env, DSH_HOME: npm.home }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      })
      expect(dump).toContain('relay-codex-host')
      const webBoot = await bootWebProfile(npm.home)
      expect(webBoot.status).toBe(200)

      const disabled = await executePlan(npm.manager, { operation: 'disable', target: PACKAGE })
      expect(disabled.completed.result).toMatchObject({ restartRequired: true })
      expect(readManagerState(npm.profileDir).disabled[PACKAGE]).toEqual(['relay-codex-host'])
      await executePlan(npm.manager, { operation: 'enable', target: PACKAGE })
      expect(readManagerState(npm.profileDir).disabled[PACKAGE]).toBeUndefined()

      const updated = await executePlan(npm.manager, { operation: 'update', target: PACKAGE })
      expect(updated.completed.result).toMatchObject({ action: 'update', restartRequired: true })
      await executePlan(npm.manager, { operation: 'remove', target: PACKAGE })
      expect(readProfileManifest(npm.profileDir).dependencies?.[PACKAGE]).toBeUndefined()
      expect(readProfileManifest(npm.profileDir).dsh?.profile?.bundles).not.toContain(PACKAGE)

      const github = await liveFixture(ctx.pluginSearch)
      homes.push(github.home)
      const githubInstall = await executePlan(github.manager, {
        operation: 'install', source: githubInspection.installSpec,
      })
      expect(githubInstall.completed.result).toMatchObject({ packageName: PACKAGE, restartRequired: true })
      expect(readProfileManifest(github.profileDir).dependencies?.[PACKAGE]).toBe(githubInspection.installSpec)
      await executePlan(github.manager, { operation: 'remove', target: PACKAGE })
      expect(readProfileManifest(github.profileDir).dependencies?.[PACKAGE]).toBeUndefined()

      process.stdout.write(`${JSON.stringify({
        package: PACKAGE,
        searchProviders: ['npm', 'github'],
        npm: { version: npmInspection.version, integrity: npmInspection.integrity, lifecycle: ['install', 'disable', 'enable', 'update', 'remove'] },
        github: { commit: githubInspection.commit, lifecycle: ['install', 'remove'] },
        webBoot,
        officialDshCli: officialCli,
      }, null, 2)}\n`)
    } finally {
      for (const home of homes) rmSync(home, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  }, 240_000)

  it('A-024/A-025 batch-plans and installs the real Codex, Files, and Terminal plugins', async () => {
    expect(existsSync(officialCli)).toBe(true)
    const ctx = new Context()
    await ctx.plugin(PluginSearchRuntime)
    const fixture = await liveFixture(ctx.pluginSearch)
    try {
      const plan = await fixture.manager.plan({ operation: 'install_many', sources: [...BATCH_PACKAGES] })
      if (plan.action !== 'install_many') throw new Error('expected install_many plan')
      expect(plan.items.map(item => item.packageName)).toEqual(BATCH_PACKAGES)
      expect(plan.missingPeerDependencies).toContainEqual({
        packageName: 'relay-dsh-plugin-workbench',
        ranges: ['^0.1.0'],
        requiredBy: ['relay-dsh-plugin-files', 'relay-dsh-plugin-terminal'],
        suggestedSource: 'relay-dsh-plugin-workbench',
      })

      const completed = await fixture.manager.wait(fixture.manager.execute(plan.confirmationToken).id)
      expect(completed).toMatchObject({
        action: 'install_many',
        status: 'waiting_for_manual_restart',
        result: {
          changed: true,
          restartRequired: true,
          items: BATCH_PACKAGES.map(packageName => ({
            packageName,
            status: 'waiting_for_manual_restart',
          })),
        },
      })
      expect(readProfileManifest(fixture.profileDir).dependencies).toMatchObject(Object.fromEntries(
        BATCH_PACKAGES.map(packageName => [packageName, expect.any(String)]),
      ))

      for (const packageName of [...BATCH_PACKAGES].reverse()) {
        await executePlan(fixture.manager, { operation: 'remove', target: packageName })
      }
      for (const packageName of BATCH_PACKAGES) {
        expect(readProfileManifest(fixture.profileDir).dependencies?.[packageName]).toBeUndefined()
      }
    } finally {
      rmSync(fixture.home, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  }, 240_000)
})
