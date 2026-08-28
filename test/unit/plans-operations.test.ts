import { describe, expect, it, vi } from 'vitest'
import { OperationTracker } from '../../src/operations.ts'
import { PlanStore } from '../../src/plans.ts'

describe('PM-009 confirmation plans', () => {
  it('binds an immutable one-use token to a digest and expiry', () => {
    let now = Date.parse('2026-08-26T00:00:00Z')
    let sequence = 0
    const store = new PlanStore({ now: () => now, random: () => `id-${++sequence}`, ttlMs: 1_000 })
    const plan = store.create({
      action: 'install', profile: 'web', packageName: 'example', installSpec: 'example@1.0.0',
      impact: 'Install example.', restartExpected: false,
    })
    expect(plan.confirmationToken).toBe('id-2')
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(store.consume(plan.confirmationToken)).toEqual(plan)
    expect(() => store.consume(plan.confirmationToken)).toThrow(/already been used/)

    const expired = store.create({
      action: 'remove', profile: 'web', packageName: 'example', impact: 'Remove example.', restartExpected: true,
    })
    now += 2_000
    expect(() => store.consume(expired.confirmationToken)).toThrow(/expired/)
  })

  it('deeply freezes aggregate install items and includes them in the digest', () => {
    let sequence = 0
    const store = new PlanStore({ random: () => `batch-${++sequence}` })
    const input = {
      action: 'install_many' as const,
      profile: 'web' as const,
      items: [{
        action: 'install' as const,
        packageName: 'plugin-a',
        installSpec: 'plugin-a@1.0.0',
        impact: 'Install plugin-a.',
        restartExpected: true,
      }],
      missingPeerDependencies: [{
        packageName: 'plugin-companion',
        ranges: ['^1.0.0'],
        requiredBy: ['plugin-a'],
        suggestedSource: 'plugin-companion',
      }],
      impact: 'Install 1 plugin serially.',
      restartExpected: true,
    }
    const plan = store.create(input)
    input.items[0]!.installSpec = 'plugin-a@9.9.9'

    expect(plan.items[0]!.installSpec).toBe('plugin-a@1.0.0')
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.items)).toBe(true)
    expect(Object.isFrozen(plan.items[0])).toBe(true)
    expect(Object.isFrozen(plan.missingPeerDependencies[0]!.ranges)).toBe(true)
    expect(() => { plan.items[0]!.installSpec = 'plugin-a@2.0.0' }).toThrow(TypeError)

    const different = store.create({
      ...input,
      items: [{ ...input.items[0]!, installSpec: 'plugin-a@2.0.0' }],
    })
    expect(different.digest).not.toBe(plan.digest)
  })
})

describe('PM-015 tracked operations', () => {
  it('tracks progress, queues concurrent work in FIFO order, and retains terminal results', async () => {
    let release!: () => void
    let sequence = 0
    const calls: string[] = []
    const tracker = new OperationTracker({ random: () => `op-${++sequence}` })
    const started = tracker.start('install', 'example', async ({ progress }) => {
      calls.push('first')
      progress('downloading')
      await new Promise<void>(resolve => { release = resolve })
      return { installed: true }
    })
    expect(started).toMatchObject({ id: 'op-1', status: 'queued' })
    await Promise.resolve()
    expect(tracker.get('op-1')).toMatchObject({ status: 'running', progress: 'downloading' })
    const queued = tracker.start('remove', 'other', async () => {
      calls.push('second')
      return { removed: true }
    })
    expect(queued).toMatchObject({ id: 'op-2', status: 'queued' })
    expect(calls).toEqual(['first'])
    release()
    await expect(tracker.wait('op-1')).resolves.toMatchObject({
      status: 'succeeded', result: { installed: true }, progress: 'completed',
    })
    await expect(tracker.wait('op-2')).resolves.toMatchObject({
      status: 'succeeded', result: { removed: true }, progress: 'completed',
    })
    expect(calls).toEqual(['first', 'second'])
  })

  it('propagates cancellation to the operation signal', async () => {
    const tracker = new OperationTracker({ random: () => 'op-cancel' })
    let observed = false
    tracker.start('update', 'example', async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
        observed = true
        resolve()
      }, { once: true }))
      return {}
    })
    await Promise.resolve()
    tracker.cancel('op-cancel')
    await expect(tracker.wait('op-cancel')).resolves.toMatchObject({ status: 'cancelled' })
    expect(observed).toBe(true)
  })

  it('maps completed results to explicit restart-aware terminal states', async () => {
    let sequence = 0
    const tracker = new OperationTracker({ random: () => `op-${++sequence}` })
    const automatic = tracker.start('install', 'plugin-a', async () => ({ restartRequired: true }), () => ({
      status: 'succeeded_restart_required',
    }))
    await expect(tracker.wait(automatic.id)).resolves.toMatchObject({
      status: 'succeeded_restart_required',
      result: { restartRequired: true },
      progress: 'completed',
    })

    const manual = tracker.start('install', 'plugin-b', async () => ({ restartRequired: true }), () => ({
      status: 'waiting_for_manual_restart',
      progress: 'manual restart required',
    }))
    await expect(tracker.wait(manual.id)).resolves.toMatchObject({
      status: 'waiting_for_manual_restart',
      result: { restartRequired: true },
      progress: 'manual restart required',
    })
  })

  it('cancels queued work without invoking its executor', async () => {
    let release!: () => void
    let sequence = 0
    const tracker = new OperationTracker({ random: () => `queued-${++sequence}` })
    const active = tracker.start('install', 'active', async () => {
      await new Promise<void>(resolve => { release = resolve })
      return {}
    })
    await Promise.resolve()
    const execute = vi.fn(async () => ({}))
    const queued = tracker.start('install', 'queued', execute)

    expect(tracker.cancel(queued.id)).toMatchObject({ status: 'cancelled', progress: 'cancelled' })
    await expect(tracker.wait(queued.id)).resolves.toMatchObject({ status: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()
    release()
    await tracker.wait(active.id)
  })
})
