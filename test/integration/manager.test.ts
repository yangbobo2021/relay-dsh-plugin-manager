import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginManager } from '../../src/manager.ts'
import { readManagerState, readProfileManifest, writeProfileManifest } from '../../src/profile.ts'
import type { PluginInspection } from '../../src/source.ts'

const PACKAGE = 'example-dsh-plugin'
const VERSION = '1.2.3'
const INSTALL_SPEC = `${PACKAGE}@${VERSION}`

function inspection(version = VERSION): PluginInspection {
  return {
    source: { kind: 'npm', package: PACKAGE, version },
    sourceType: 'npm',
    requestedSpec: PACKAGE,
    installSpec: `${PACKAGE}@${version}`,
    packageName: PACKAGE,
    version,
    integrity: 'sha512-dGVzdA==',
    repository: 'github.com/example/plugin',
    description: 'fixture plugin',
    bundlePatch: 'cordis.patch.yml',
    client: false,
    peerDependencies: {},
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
  runPlugin: (profile: string, args: readonly string[]) => Promise<{
    exitCode: number
    stdout: string
    stderr: string
    signal: NodeJS.Signals | null
    timedOut: boolean
    cancelled: boolean
  }>,
  options: {
    hotActive?: boolean
    hotRestartRequired?: boolean
    dynamicLoader?: boolean
    restartAvailable?: boolean
  } = {},
): PluginManager {
  let hotActive = options.hotActive ?? false
  return new PluginManager({
    profileDir,
    searchRuntime: { entries: () => [] },
    runner: { runPlugin },
    inspect: vi.fn(async (_source: unknown) => inspection()),
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
