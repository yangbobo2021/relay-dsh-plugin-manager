import { randomUUID } from 'node:crypto'
import { fail } from './errors.ts'
import type { PlanAction } from './plans.ts'

export type OperationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'succeeded_restart_required'
  | 'waiting_for_manual_restart'
  | 'failed'
  | 'cancelled'

export type CompletedOperationStatus = Exclude<OperationStatus, 'queued' | 'running' | 'cancelled'>

export interface OperationSnapshot<T = unknown> {
  id: string
  action: PlanAction
  target: string
  status: OperationStatus
  progress: string
  startedAt: string
  finishedAt?: string
  result?: T
  error?: { code?: string; message: string }
}

interface OperationRecord {
  snapshot: OperationSnapshot<unknown>
  controller: AbortController
  done: Promise<void>
  resolveDone(): void
  execute(context: OperationContext): Promise<unknown>
  complete(result: unknown): OperationCompletion
}

export interface OperationContext {
  signal: AbortSignal
  progress(message: string): void
}

export interface OperationCompletion {
  status: CompletedOperationStatus
  progress?: string
  error?: { code?: string; message: string }
}

export class OperationTracker {
  private readonly records = new Map<string, OperationRecord>()
  private readonly queue: string[] = []
  private active: string | null = null
  private readonly random: () => string
  private readonly now: () => number

  constructor(options: { random?: () => string; now?: () => number } = {}) {
    this.random = options.random ?? randomUUID
    this.now = options.now ?? Date.now
  }

  start<T>(
    action: PlanAction,
    target: string,
    execute: (context: OperationContext) => Promise<T>,
    complete: (result: T) => OperationCompletion = () => ({ status: 'succeeded' }),
  ): OperationSnapshot<T> {
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
    let resolveDone!: () => void
    const record: OperationRecord = {
      snapshot,
      controller,
      done: new Promise<void>(resolve => { resolveDone = resolve }),
      resolveDone,
      execute: async context => await execute(context),
      complete: result => complete(result as T),
    }
    this.records.set(id, record)
    this.queue.push(id)
    queueMicrotask(() => this.drain())
    return structuredClone(snapshot)
  }

  private drain(): void {
    if (this.active !== null) return
    const id = this.queue.shift()
    if (id === undefined) return
    const record = this.records.get(id)
    if (record === undefined || record.snapshot.status !== 'queued') {
      queueMicrotask(() => this.drain())
      return
    }
    this.active = id
    void this.run(id, record)
  }

  private async run(id: string, record: OperationRecord): Promise<void> {
    const { snapshot, controller } = record
    snapshot.status = 'running'
    snapshot.progress = 'running'
    try {
      const result = await record.execute({
        signal: controller.signal,
        progress: message => { snapshot.progress = message.slice(0, 500) },
      })
      snapshot.result = result
      if (controller.signal.aborted) {
        snapshot.status = 'cancelled'
        snapshot.progress = 'cancelled'
      } else {
        const completion = record.complete(result)
        snapshot.status = completion.status
        snapshot.progress = completion.progress ?? 'completed'
        if (completion.error !== undefined) snapshot.error = completion.error
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
      record.resolveDone()
      queueMicrotask(() => this.drain())
    }
  }

  get(id: string): OperationSnapshot {
    const record = this.records.get(id)
    if (record === undefined) fail('OPERATION_NOT_FOUND', `Plugin operation ${id} was not found.`)
    return structuredClone(record.snapshot)
  }

  cancel(id: string): OperationSnapshot {
    const record = this.records.get(id)
    if (record === undefined) fail('OPERATION_NOT_FOUND', `Plugin operation ${id} was not found.`)
    if (record.snapshot.status === 'queued') {
      const index = this.queue.indexOf(id)
      if (index >= 0) this.queue.splice(index, 1)
      record.controller.abort(new Error('Plugin operation cancelled by user.'))
      record.snapshot.status = 'cancelled'
      record.snapshot.progress = 'cancelled'
      record.snapshot.finishedAt = new Date(this.now()).toISOString()
      record.resolveDone()
    } else if (record.snapshot.status === 'running') {
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
