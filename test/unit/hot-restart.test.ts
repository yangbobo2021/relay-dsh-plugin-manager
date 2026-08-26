import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HotRuntime, parseSimpleHotPatch } from '../../src/hot-runtime.ts'
import { detectedSupervisor, DshRestarter, restartAllowed } from '../../src/restart.ts'

describe('PM-013 simple hot activation', () => {
  it('accepts only plain insert rows', () => {
    expect(parseSimpleHotPatch('- insert:\n    - id: host\n      name: plugin\n'))
      .toEqual([{ id: 'host', name: 'plugin' }])
    expect(parseSimpleHotPatch('- insert:\n    - id: host\n      name: plugin\n      config: {}\n')).toBeNull()
    expect(parseSimpleHotPatch('- id: host\n  disabled: true\n')).toBeNull()
  })

  it('mounts a simple bundle and disposes it live', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-hot-'))
    mkdirSync(join(dir, 'node_modules', 'plugin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'plugin', 'cordis.patch.yml'), '- insert:\n    - id: host\n      name: plugin\n')
    const dispose = vi.fn(async () => undefined)
    const plugin = vi.fn(() => ({ await: async () => undefined, dispose }))
    class FakeInclude {}
    const hot = new HotRuntime({ plugin }, dir, 100, async () => FakeInclude)
    await expect(hot.activate({
      packageName: 'plugin', source: '1.0.0', bundle: true,
      bundlePatch: './cordis.patch.yml', client: false, entryIds: ['host'],
    })).resolves.toEqual({ active: true, restartRequired: false, reason: null })
    expect(hot.isActive('plugin')).toBe(true)
    await expect(hot.deactivate('plugin')).resolves.toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('falls back to restart for complex patches and unavailable Include', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-hot-'))
    mkdirSync(join(dir, 'node_modules', 'plugin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'plugin', 'cordis.patch.yml'), '- insert:\n    - id: host\n      name: plugin\n      config: {}\n')
    const unavailable = new HotRuntime({ plugin: vi.fn() }, dir, 100, async () => null)
    await expect(unavailable.activate({
      packageName: 'plugin', source: '1.0.0', bundle: true,
      bundlePatch: './cordis.patch.yml', client: false, entryIds: ['host'],
    })).resolves.toMatchObject({ active: false, restartRequired: true })

    class FakeInclude {}
    const complex = new HotRuntime({ plugin: vi.fn() }, dir, 100, async () => FakeInclude)
    await expect(complex.activate({
      packageName: 'plugin', source: '1.0.0', bundle: true,
      bundlePatch: './cordis.patch.yml', client: false, entryIds: ['host'],
    })).resolves.toMatchObject({ active: false, reason: expect.stringContaining('plain insert-only') })
  })

  it('disposes failed and timed-out activation handles and requires restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-hot-'))
    mkdirSync(join(dir, 'node_modules', 'plugin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'plugin', 'cordis.patch.yml'), '- insert:\n    - id: host\n      name: plugin\n')
    class FakeInclude {}
    const timeoutDispose = vi.fn(async () => undefined)
    const timedOut = new HotRuntime({
      plugin: vi.fn(() => ({ await: () => new Promise(() => undefined), dispose: timeoutDispose })),
    }, dir, 5, async () => FakeInclude)
    const surface = {
      packageName: 'plugin', source: '1.0.0', bundle: true,
      bundlePatch: './cordis.patch.yml', client: false, entryIds: ['host'],
    }
    await expect(timedOut.activate(surface)).resolves.toMatchObject({
      active: false, restartRequired: true, reason: 'hot activation timed out',
    })
    expect(timeoutDispose).toHaveBeenCalledOnce()

    const thrown = new HotRuntime({ plugin: vi.fn(() => { throw new Error('mount failed') }) }, dir, 5, async () => FakeInclude)
    await expect(thrown.activate(surface)).resolves.toMatchObject({
      active: false, restartRequired: true, reason: 'mount failed',
    })
  })
})

describe('PM-016 restart policy', () => {
  it('detects a systemd-owned main process and honors explicit policy', () => {
    expect(detectedSupervisor({ INVOCATION_ID: 'x' }, 1)).toBe('systemd')
    expect(detectedSupervisor({ INVOCATION_ID: 'x' }, 42)).toBeNull()
    expect(restartAllowed(undefined, { INVOCATION_ID: 'x' }, 1)).toBe(false)
    expect(restartAllowed(true, { INVOCATION_ID: 'x' }, 1)).toBe(true)
    expect(restartAllowed(false, {}, 42)).toBe(false)
  })

  it('schedules the exact current Node entry and defers termination', () => {
    const calls: unknown[][] = []
    const fakeChild = { pid: 123, unref: vi.fn() }
    const spawn = ((...args: unknown[]) => { calls.push(args); return fakeChild }) as never
    const terminate = vi.fn()
    vi.useFakeTimers()
    try {
      const restarter = new DshRestarter({
        allowRestart: true,
        argv: ['node', '/opt/dsh/bin.js', 'web', '--no-open'],
        execPath: '/opt/node',
        cwd: '/work',
        spawn,
        terminate,
      })
      expect(restarter.schedule()).toMatchObject({ helperPid: 123 })
      expect(calls[0]?.[0]).toBe('/opt/node')
      expect(String((calls[0]?.[1] as string[])[1])).toContain('/opt/dsh/bin.js')
      vi.advanceTimersByTime(500)
      expect(terminate).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
