import { createHash, randomUUID } from 'node:crypto'
import { fail } from './errors.ts'

export type MutationAction = 'install' | 'remove' | 'update' | 'enable' | 'disable' | 'restart'
export type PlanAction = MutationAction | 'install_many'

export interface SinglePlanInput {
  action: MutationAction
  profile: 'web'
  packageName?: string
  installSpec?: string
  currentSource?: string
  impact: string
  restartExpected: boolean
  items?: never
  missingPeerDependencies?: never
}

export interface InstallPlanItem {
  action: 'install'
  packageName: string
  installSpec: string
  impact: string
  restartExpected: boolean
}

export interface MissingPeerDependency {
  packageName: string
  ranges: string[]
  requiredBy: string[]
  suggestedSource: string
}

export interface InstallManyPlanInput {
  action: 'install_many'
  profile: 'web'
  items: InstallPlanItem[]
  missingPeerDependencies: MissingPeerDependency[]
  impact: string
  restartExpected: boolean
  packageName?: never
  installSpec?: never
  currentSource?: never
}

export type PlanInput = SinglePlanInput | InstallManyPlanInput

interface ConfirmationFields {
  id: string
  digest: string
  confirmationToken: string
  createdAt: string
  expiresAt: string
}

export type ConfirmationPlan<Input extends PlanInput = PlanInput> = Input & ConfirmationFields

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

  create<Input extends PlanInput>(input: Input): ConfirmationPlan<Input> {
    const created = this.now()
    const id = this.random()
    const confirmationToken = this.random()
    const snapshot = structuredClone(input)
    const digest = createHash('sha256').update(JSON.stringify({ id, ...snapshot })).digest('hex')
    const plan = deepFreeze({
      ...snapshot,
      id,
      digest,
      confirmationToken,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.ttlMs).toISOString(),
    })
    this.plans.set(confirmationToken, plan)
    return plan as ConfirmationPlan<Input>
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

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
