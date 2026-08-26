import { randomUUID } from 'node:crypto'
import { fail } from './errors.ts'
import type { MutationAction } from './plans.ts'

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface OperationSnapshot<T = unknown> {
  id: string
  action: MutationAction
  target: string
  status: OperationStatus
  progress: string
  startedAt: string
  finishedAt?: string
  result?: T
  error?: { code?: string; message: string }
}

interface OperationRecord<T> {
  snapshot: OperationSnapshot<T>
  controller: AbortController
  done: Promise<void>
}

export interface OperationContext {
  signal: AbortSignal
  progress(message: string): void
}

export class OperationTracker {
  private readonly records = new Map<string, OperationRecord<unknown>>()
  private active: string | null = null
  private readonly random: () => string
  private readonly now: () => number

  constructor(options: { random?: () => string; now?: () => number } = {}) {
    this.random = options.random ?? randomUUID
    this.now = options.now ?? Date.now
  }

  start<T>(
    action: MutationAction,
    target: string,
    execute: (context: OperationContext) => Promise<T>,
  ): OperationSnapshot<T> {
    if (this.active !== null) fail('OPERATION_BUSY', `Plugin operation ${this.active} is still running.`)
    const id = this.random()
    const controller = new AbortController()
    const snapshot: OperationSnapshot<T> = {
      id,
      action,
      target,
      status: 'queued',
      progress: 'queued',
      startedAt: new Date(this.now()).toISOString(),
    }
    const record: OperationRecord<T> = { snapshot, controller, done: Promise.resolve() }
    this.records.set(id, record as OperationRecord<unknown>)
    this.active = id
    record.done = Promise.resolve().then(async () => {
      snapshot.status = 'running'
      snapshot.progress = 'running'
      try {
        const result = await execute({
          signal: controller.signal,
          progress: message => { snapshot.progress = message.slice(0, 500) },
        })
        if (controller.signal.aborted) {
          snapshot.status = 'cancelled'
          snapshot.progress = 'cancelled'
        } else {
          snapshot.status = 'succeeded'
          snapshot.progress = 'completed'
          snapshot.result = result
        }
      } catch (error) {
        if (controller.signal.aborted) {
          snapshot.status = 'cancelled'
          snapshot.progress = 'cancelled'
        } else {
          snapshot.status = 'failed'
          snapshot.progress = 'failed'
          snapshot.error = {
            ...typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
              ? { code: error.code }
              : {},
            message: error instanceof Error ? error.message : String(error),
          }
        }
      } finally {
        snapshot.finishedAt = new Date(this.now()).toISOString()
        if (this.active === id) this.active = null
      }
    })
    return structuredClone(snapshot)
  }

  get(id: string): OperationSnapshot {
    const record = this.records.get(id)
    if (record === undefined) fail('OPERATION_NOT_FOUND', `Plugin operation ${id} was not found.`)
    return structuredClone(record.snapshot)
  }

  cancel(id: string): OperationSnapshot {
    const record = this.records.get(id)
    if (record === undefined) fail('OPERATION_NOT_FOUND', `Plugin operation ${id} was not found.`)
    if (record.snapshot.status === 'queued' || record.snapshot.status === 'running') {
      record.snapshot.progress = 'cancelling'
      record.controller.abort(new Error('Plugin operation cancelled by user.'))
    }
    return structuredClone(record.snapshot)
  }

  async wait(id: string): Promise<OperationSnapshot> {
    const record = this.records.get(id)
    if (record === undefined) fail('OPERATION_NOT_FOUND', `Plugin operation ${id} was not found.`)
    await record.done
    return this.get(id)
  }
}
