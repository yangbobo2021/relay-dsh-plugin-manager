import { createHash, randomUUID } from 'node:crypto'
import { fail } from './errors.ts'

export type MutationAction = 'install' | 'remove' | 'update' | 'enable' | 'disable' | 'restart'

export interface PlanInput {
  action: MutationAction
  profile: 'web'
  packageName?: string
  installSpec?: string
  currentSource?: string
  impact: string
  restartExpected: boolean
}

export interface ConfirmationPlan extends PlanInput {
  id: string
  digest: string
  confirmationToken: string
  createdAt: string
  expiresAt: string
}

export interface PlanStoreOptions {
  now?: () => number
  random?: () => string
  ttlMs?: number
}

export class PlanStore {
  private readonly plans = new Map<string, ConfirmationPlan>()
  private readonly used = new Set<string>()
  private readonly now: () => number
  private readonly random: () => string
  private readonly ttlMs: number

  constructor(options: PlanStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? randomUUID
    this.ttlMs = options.ttlMs ?? 10 * 60_000
  }

  create(input: PlanInput): ConfirmationPlan {
    const created = this.now()
    const id = this.random()
    const confirmationToken = this.random()
    const digest = createHash('sha256').update(JSON.stringify({ id, ...input })).digest('hex')
    const plan = Object.freeze({
      ...input,
      id,
      digest,
      confirmationToken,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.ttlMs).toISOString(),
    })
    this.plans.set(confirmationToken, plan)
    return plan
  }

  consume(token: string): ConfirmationPlan {
    if (this.used.has(token)) fail('CONFIRMATION_REPLAYED', 'Confirmation token has already been used.')
    const plan = this.plans.get(token)
    if (plan === undefined) fail('CONFIRMATION_REQUIRED', 'A valid confirmation token is required.')
    this.plans.delete(token)
    this.used.add(token)
    if (this.now() >= Date.parse(plan.expiresAt)) fail('CONFIRMATION_EXPIRED', 'Confirmation token has expired.')
    return plan
  }
}
