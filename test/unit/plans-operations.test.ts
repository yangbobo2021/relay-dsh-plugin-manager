import { describe, expect, it } from 'vitest'
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
  it('tracks progress, refuses concurrency, and retains terminal results', async () => {
    let release!: () => void
    const tracker = new OperationTracker({ random: () => 'op-1' })
    const started = tracker.start('install', 'example', async ({ progress }) => {
      progress('downloading')
      await new Promise<void>(resolve => { release = resolve })
      return { installed: true }
    })
    expect(started).toMatchObject({ id: 'op-1', status: 'queued' })
    await Promise.resolve()
    expect(tracker.get('op-1')).toMatchObject({ status: 'running', progress: 'downloading' })
    expect(() => tracker.start('remove', 'other', async () => ({}))).toThrow(/still running/)
    release()
    await expect(tracker.wait('op-1')).resolves.toMatchObject({
      status: 'succeeded', result: { installed: true }, progress: 'completed',
    })
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
})
