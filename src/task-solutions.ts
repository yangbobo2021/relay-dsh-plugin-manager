import { randomUUID } from 'node:crypto'
import { fail } from './errors.ts'
import type { SearchResult } from './search.ts'

const DEFAULT_TTL_MS = 10 * 60 * 1_000
const MAX_ROLES = 8
const MAX_AMBIGUITIES = 4
const MAX_OPTIONS = 8
const MAX_DRAFTS = 32
const ROLE_ID = /^[a-z][a-z0-9_]{0,63}$/u

export interface TaskRoleInput {
  id: string
  label: string
  query: string
  required?: boolean
}

export interface TaskRole {
  id: string
  label: string
  query: string
  required: boolean
}

export interface TaskAmbiguityInput {
  id: string
  question: string
  options: string[]
}

export interface TaskSolutionPlan {
  task: string
  roles: TaskRole[]
  ambiguities: TaskAmbiguityInput[]
}

export type TaskSolutionCandidate = Omit<SearchResult['candidates'][number], 'sources'>

export interface TaskRoleSearchGroup extends TaskRole {
  candidates: TaskSolutionCandidate[]
  providerErrors: SearchResult['providerErrors']
  rejectedCandidates: number
}

export interface TaskSolutionDraft {
  schemaVersion: '1.0.0'
  solutionId: string
  task: string
  status: 'needs_review' | 'incomplete' | 'ambiguous'
  createdAt: number
  expiresAt: number
  roles: TaskRoleSearchGroup[]
  ambiguities: TaskAmbiguityInput[]
}

export interface TaskRoleSelection {
  roleId: string
  candidateIdentities: string[]
}

export interface AssessedTaskRole extends TaskRole {
  status: 'covered' | 'missing_required' | 'missing_optional'
  primaryCandidateIdentity: string | null
  alternativeCandidateIdentities: string[]
}

export interface TaskSolutionAssessment {
  schemaVersion: '1.0.0'
  solutionId: string
  task: string
  status: 'complete' | 'incomplete' | 'ambiguous'
  roles: AssessedTaskRole[]
  ambiguities: TaskAmbiguityInput[]
  solutions: Array<TaskSolutionCandidate & { roleIds: string[] }>
  coverage: {
    requiredRoles: number
    coveredRequiredRoles: number
    optionalRoles: number
    coveredOptionalRoles: number
    missingRequiredRoleIds: string[]
    complete: boolean
  }
}

function bounded(value: unknown, name: string, maximum: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || text.length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    fail('INVALID_TASK_SOLUTION', `${name} must contain 1 to ${String(maximum)} printable characters.`)
  }
  return text
}

export function validateTaskSolutionPlan(
  taskValue: string,
  roleValues: TaskRoleInput[],
  ambiguityValues: TaskAmbiguityInput[] = [],
): TaskSolutionPlan {
  const task = bounded(taskValue, 'Task', 1_000)
  if (!Array.isArray(roleValues) || roleValues.length < 1 || roleValues.length > MAX_ROLES) {
    fail('INVALID_TASK_SOLUTION', `A task solution requires 1 to ${String(MAX_ROLES)} roles.`)
  }
  const roleIds = new Set<string>()
  const roleLabels = new Set<string>()
  const roleQueries = new Set<string>()
  const roles = roleValues.map((value): TaskRole => {
    const id = typeof value?.id === 'string' ? value.id.trim() : ''
    if (!ROLE_ID.test(id)) fail('INVALID_TASK_SOLUTION', 'Role ids must be lowercase stable identifiers.')
    if (roleIds.has(id)) fail('INVALID_TASK_SOLUTION', 'Role ids must be unique.')
    roleIds.add(id)
    const label = bounded(value.label, 'Role label', 80)
    const query = bounded(value.query, 'Role query', 120)
    const labelKey = label.toLocaleLowerCase()
    const queryKey = query.toLocaleLowerCase().replace(/\s+/gu, ' ')
    if (roleLabels.has(labelKey) || roleQueries.has(queryKey)) {
      fail('INVALID_TASK_SOLUTION', 'Role labels and focused queries must be unique.')
    }
    roleLabels.add(labelKey)
    roleQueries.add(queryKey)
    return {
      id,
      label,
      query,
      required: value.required !== false,
    }
  })
  if (!Array.isArray(ambiguityValues) || ambiguityValues.length > MAX_AMBIGUITIES) {
    fail('INVALID_TASK_SOLUTION', `A task solution supports at most ${String(MAX_AMBIGUITIES)} unresolved ambiguities.`)
  }
  const ambiguityIds = new Set<string>()
  const ambiguities = ambiguityValues.map((value): TaskAmbiguityInput => {
    const id = typeof value?.id === 'string' ? value.id.trim() : ''
    if (!ROLE_ID.test(id) || ambiguityIds.has(id) || roleIds.has(id)) fail('INVALID_TASK_SOLUTION', 'Ambiguity ids must be unique lowercase stable identifiers and cannot reuse a role id.')
    ambiguityIds.add(id)
    if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > MAX_OPTIONS) {
      fail('INVALID_TASK_SOLUTION', `Each ambiguity requires 2 to ${String(MAX_OPTIONS)} options.`)
    }
    const options = value.options.map(option => bounded(option, 'Ambiguity option', 80))
    if (new Set(options).size !== options.length) fail('INVALID_TASK_SOLUTION', 'Ambiguity options must be unique.')
    return { id, question: bounded(value.question, 'Ambiguity question', 200), options }
  })
  return { task, roles, ambiguities }
}

function candidateSummary(candidate: SearchResult['candidates'][number]): TaskSolutionCandidate {
  const { sources: _sources, ...summary } = candidate
  return structuredClone(summary)
}

export interface TaskSolutionStoreOptions {
  now?: () => number
  id?: () => string
  ttlMs?: number
}

export class TaskSolutionStore {
  private readonly now: () => number
  private readonly id: () => string
  private readonly ttlMs: number
  private readonly drafts = new Map<string, TaskSolutionDraft>()

  constructor(options: TaskSolutionStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.id = options.id ?? (() => `task-solution:${randomUUID()}`)
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1_000 || this.ttlMs > 60 * 60 * 1_000) {
      throw new RangeError('Task solution ttlMs must be from 1 second to 1 hour.')
    }
  }

  create(input: {
    task: string
    roles: TaskRoleInput[]
    ambiguities?: TaskAmbiguityInput[]
    searches: Record<string, SearchResult>
  }): TaskSolutionDraft {
    const plan = validateTaskSolutionPlan(input.task, input.roles, input.ambiguities)
    const now = this.now()
    for (const [id, draft] of this.drafts) if (draft.expiresAt <= now) this.drafts.delete(id)
    while (this.drafts.size >= MAX_DRAFTS) this.drafts.delete(this.drafts.keys().next().value as string)

    const roles = plan.roles.map((role): TaskRoleSearchGroup => {
      const search = input.searches[role.id]
      if (search === undefined) fail('INVALID_TASK_SOLUTION', `Search results are missing for role ${role.id}.`)
      return {
        ...role,
        candidates: search.candidates.map(candidateSummary),
        providerErrors: structuredClone(search.providerErrors),
        rejectedCandidates: search.rejectedCandidates,
      }
    })
    const requiredCandidateMissing = roles.some(role => role.required && role.candidates.length === 0)
    const draft: TaskSolutionDraft = {
      schemaVersion: '1.0.0',
      solutionId: bounded(this.id(), 'Task solution id', 200),
      task: plan.task,
      status: plan.ambiguities.length > 0 ? 'ambiguous' : requiredCandidateMissing ? 'incomplete' : 'needs_review',
      createdAt: now,
      expiresAt: now + this.ttlMs,
      roles,
      ambiguities: plan.ambiguities,
    }
    if (this.drafts.has(draft.solutionId)) fail('INVALID_TASK_SOLUTION', 'Task solution id must be unique.')
    this.drafts.set(draft.solutionId, draft)
    return structuredClone(draft)
  }

  assess(solutionIdValue: string, selectionValues: TaskRoleSelection[]): TaskSolutionAssessment {
    const solutionId = bounded(solutionIdValue, 'Task solution id', 200)
    const draft = this.drafts.get(solutionId)
    if (draft === undefined) fail('TASK_SOLUTION_NOT_FOUND', 'Task solution draft was not found.')
    if (draft.expiresAt <= this.now()) {
      this.drafts.delete(solutionId)
      fail('TASK_SOLUTION_EXPIRED', 'Task solution draft has expired; search the roles again.')
    }
    if (!Array.isArray(selectionValues) || selectionValues.length > draft.roles.length) fail('INVALID_TASK_SOLUTION', 'Task solution selections must contain at most one row per role.')
    const roleById = new Map(draft.roles.map(role => [role.id, role]))
    const selections = new Map<string, string[]>()
    for (const value of selectionValues) {
      const roleId = typeof value?.roleId === 'string' ? value.roleId.trim() : ''
      const role = roleById.get(roleId)
      if (role === undefined) fail('INVALID_TASK_SOLUTION', `Unknown task solution role ${roleId}.`)
      if (selections.has(roleId)) fail('INVALID_TASK_SOLUTION', `Role ${roleId} has duplicate selection rows.`)
      if (!Array.isArray(value.candidateIdentities) || value.candidateIdentities.length > 20) fail('INVALID_TASK_SOLUTION', `Role ${roleId} has too many candidate identities.`)
      const identities = value.candidateIdentities.map(identity => bounded(identity, 'Candidate identity', 500))
      if (new Set(identities).size !== identities.length) fail('INVALID_TASK_SOLUTION', `Role ${roleId} contains a duplicate candidate.`)
      const available = new Set(role.candidates.map(candidate => candidate.identity))
      for (const identity of identities) {
        if (!available.has(identity)) fail('INVALID_TASK_SOLUTION', `${identity} is not a candidate for role ${roleId}.`)
      }
      selections.set(roleId, identities)
    }

    const solutions = new Map<string, TaskSolutionCandidate & { roleIds: string[] }>()
    const roles = draft.roles.map((role): AssessedTaskRole => {
      const identities = selections.get(role.id) ?? []
      for (const identity of identities) {
        const candidate = role.candidates.find(item => item.identity === identity)!
        const existing = solutions.get(identity)
        if (existing === undefined) solutions.set(identity, { ...structuredClone(candidate), roleIds: [role.id] })
        else if (!existing.roleIds.includes(role.id)) existing.roleIds.push(role.id)
      }
      return {
        id: role.id,
        label: role.label,
        query: role.query,
        required: role.required,
        status: identities.length > 0 ? 'covered' : role.required ? 'missing_required' : 'missing_optional',
        primaryCandidateIdentity: identities[0] ?? null,
        alternativeCandidateIdentities: identities.slice(1),
      }
    })
    const required = roles.filter(role => role.required)
    const optional = roles.filter(role => !role.required)
    const missingRequiredRoleIds = required.filter(role => role.status !== 'covered').map(role => role.id)
    const complete = missingRequiredRoleIds.length === 0 && draft.ambiguities.length === 0
    return {
      schemaVersion: '1.0.0',
      solutionId,
      task: draft.task,
      status: draft.ambiguities.length > 0 ? 'ambiguous' : complete ? 'complete' : 'incomplete',
      roles,
      ambiguities: structuredClone(draft.ambiguities),
      solutions: [...solutions.values()],
      coverage: {
        requiredRoles: required.length,
        coveredRequiredRoles: required.filter(role => role.status === 'covered').length,
        optionalRoles: optional.length,
        coveredOptionalRoles: optional.filter(role => role.status === 'covered').length,
        missingRequiredRoleIds,
        complete,
      },
    }
  }
}
