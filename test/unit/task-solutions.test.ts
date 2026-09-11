import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../src/search.ts'
import {
  TaskSolutionStore,
  validateTaskSolutionPlan,
  type TaskRoleInput,
} from '../../src/task-solutions.ts'

interface Scenario {
  scenario_id: string
  task: string
  roles: TaskRoleInput[]
  ambiguities: Array<{ id: string; question: string; options: string[] }>
  candidates: Record<string, string[]>
  selections: Record<string, string[]>
  expected: {
    draft_status: string
    status: string
    complete: boolean
    missing_required_roles: string[]
    solution_count: number
    shared_solution_roles?: string[]
    primary?: string
    alternatives?: string[]
  }
}

const suite = JSON.parse(readFileSync(new URL('../../fixtures/evaluation/task-solution-scenarios.v1.json', import.meta.url), 'utf8')) as {
  schema_version: string
  suite_id: string
  evaluation_unit: string
  cases: Scenario[]
}

function searchResult(identities: string[]): SearchResult {
  return {
    query: 'fixture',
    candidates: identities.map((identity, index) => ({
      rank: index + 1,
      identity,
      packageName: identity.replace('plugin:', 'fixture-'),
      description: `${identity} description`,
      repository: `github.com/example/${identity.replace('plugin:', '')}`,
      repositoryOwner: 'example',
      providers: ['fixture'],
      matchReasons: [],
      semanticMatches: [],
      sources: [],
      recommendedSource: `${identity.replace('plugin:', 'fixture-')}@1.0.0`,
    })),
    presentation: {
      order: 'rank_ascending', returnedCandidates: identities.length, requestedMaximum: 20,
      includeEveryDistinctRelevantSolution: true, excludeClearlyIrrelevant: true,
      deduplicateEquivalentSources: true, padToRequestedMaximum: false, silentTopNTruncation: false,
    },
    providerErrors: [],
    rejectedCandidates: 0,
  }
}

describe('PM-029/PM-030/PM-031 task solution scenarios', () => {
  it('defines a versioned role-decomposition, grouping, and completeness suite', () => {
    expect(suite.schema_version).toBe('1.0.0')
    expect(suite.suite_id).toMatch(/^plugin-manager-task-solutions\./u)
    expect(suite.evaluation_unit).toBe('reviewed_role_selection')
    expect(suite.cases).toHaveLength(6)
    expect(suite.cases.some(item => item.roles.length >= 3)).toBe(true)
    expect(suite.cases.some(item => item.roles.some(role => role.required === false))).toBe(true)
    expect(suite.cases.some(item => item.ambiguities.length > 0)).toBe(true)
  })

  it.each(suite.cases)('$scenario_id', (scenario) => {
    let clock = Date.parse('2026-09-11T08:00:00.000Z')
    const store = new TaskSolutionStore({ now: () => clock, id: () => `solution:${scenario.scenario_id}` })
    const plan = validateTaskSolutionPlan(scenario.task, scenario.roles, scenario.ambiguities)
    const draft = store.create({
      task: plan.task,
      roles: plan.roles,
      ambiguities: plan.ambiguities,
      searches: Object.fromEntries(plan.roles.map(role => [role.id, searchResult(scenario.candidates[role.id] ?? [])])),
    })
    expect(draft.status).toBe(scenario.expected.draft_status)

    const assessment = store.assess(draft.solutionId, Object.entries(scenario.selections).map(([roleId, candidateIdentities]) => ({ roleId, candidateIdentities })))
    expect(assessment.status).toBe(scenario.expected.status)
    expect(assessment.coverage.complete).toBe(scenario.expected.complete)
    expect(assessment.coverage.missingRequiredRoleIds).toEqual(scenario.expected.missing_required_roles)
    expect(assessment.solutions).toHaveLength(scenario.expected.solution_count)

    if (scenario.expected.shared_solution_roles !== undefined) {
      expect(assessment.solutions[0]?.roleIds).toEqual(scenario.expected.shared_solution_roles)
    }
    if (scenario.expected.primary !== undefined) {
      expect(assessment.roles[0]?.primaryCandidateIdentity).toBe(scenario.expected.primary)
      expect(assessment.roles[0]?.alternativeCandidateIdentities).toEqual(scenario.expected.alternatives)
    }
    clock += 1
  })

  it('rejects duplicate roles, cross-role candidate selection, duplicate selection, and expired drafts', () => {
    const role = { id: 'one_role', label: 'One role', query: 'find one role', required: true }
    expect(() => validateTaskSolutionPlan('task', [role, role], [])).toThrow(/role ids must be unique/iu)
    expect(() => validateTaskSolutionPlan('task', [role, { ...role, id: 'other_role' }], [])).toThrow(/focused queries must be unique/iu)
    expect(() => validateTaskSolutionPlan('task', [role], [{ id: 'one_role', question: 'Which?', options: ['A', 'B'] }])).toThrow(/cannot reuse a role id/iu)

    let clock = 1_000
    const store = new TaskSolutionStore({ now: () => clock, id: () => 'solution:test', ttlMs: 1_000 })
    const draft = store.create({
      task: 'two roles',
      roles: [role, { id: 'two_role', label: 'Two role', query: 'find two role', required: true }],
      ambiguities: [],
      searches: { one_role: searchResult(['plugin:one']), two_role: searchResult(['plugin:two']) },
    })
    expect(() => store.assess(draft.solutionId, [{ roleId: 'one_role', candidateIdentities: ['plugin:two'] }]))
      .toThrow(/not a candidate for role/iu)
    expect(() => store.assess(draft.solutionId, [{ roleId: 'one_role', candidateIdentities: ['plugin:one', 'plugin:one'] }]))
      .toThrow(/duplicate candidate/iu)
    clock = 2_001
    expect(() => store.assess(draft.solutionId, [])).toThrow(/expired/iu)
  })
})
