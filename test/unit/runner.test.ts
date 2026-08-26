import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { DshCliRunner, resolveDshLaunch } from '../../src/runner.ts'

function childProcess() {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
      return true
    }),
  })
  return child
}

describe('DshCliRunner', () => {
  it('uses argv-only execution with the exact DSH plugin profile prefix', async () => {
    const child = childProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const runner = new DshCliRunner({
      env: { DSH_EXECUTABLE: '/opt/dsh' }, cwd: '/workspace', spawn: spawnImpl,
    })
    const promise = runner.runPlugin(
      'web', ['add', '--save-exact', 'example@1.2.3'], new AbortController().signal,
    )
    ;(child.stdout as PassThrough).write('installed\n')
    child.emit('close', 0, null)

    await expect(promise).resolves.toMatchObject({ exitCode: 0, stdout: 'installed\n', cancelled: false })
    expect(spawnImpl).toHaveBeenCalledWith(
      '/opt/dsh',
      ['plugin', '--profile', 'web', 'add', '--save-exact', 'example@1.2.3'],
      expect.objectContaining({ cwd: '/workspace', shell: false, stdio: ['ignore', 'pipe', 'pipe'] }),
    )
  })

  it('propagates cancellation to the child process and records signal termination', async () => {
    const child = childProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const controller = new AbortController()
    const promise = new DshCliRunner({
      env: { DSH_EXECUTABLE: '/opt/dsh' }, spawn: spawnImpl,
    }).runPlugin('web', ['remove', 'example'], controller.signal)
    controller.abort()

    await expect(promise).resolves.toMatchObject({
      exitCode: 1, signal: 'SIGTERM', cancelled: true, timedOut: false,
    })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('falls back to the current Node entry point before PATH lookup', () => {
    expect(resolveDshLaunch({
      env: {}, argv: ['node', import.meta.filename], execPath: '/node', cwd: '/cwd', platform: 'linux',
    })).toEqual({ file: '/node', prefix: [import.meta.filename], cwd: '/cwd', shell: false })
  })
})
