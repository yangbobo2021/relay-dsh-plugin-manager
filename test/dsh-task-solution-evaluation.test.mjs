import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateDshTaskSolutionScenario } from '../scripts/dsh-task-solution-evaluation.mjs'

const scenario = {
  id: 'composition',
  prompt: 'find plugins',
  exactRoleCount: 3,
  roles: [
    { key: 'reader', roleMatchAny: ['进程状态'], solutionMatchAny: ['monitor-process'] },
    { key: 'waiter', roleMatchAny: ['持久等待'], solutionMatchAny: ['plugin-monitors'] },
    { key: 'delivery', roleMatchAny: ['飞书'], solutionMatchAny: ['lark-bot'] },
  ],
}

function candidate(identity) {
  return { identity, packageName: identity, semanticMatches: ['directory/path'] }
}

function fixture() {
  const roles = [
    { id: 'reader', label: '进程状态读取', query: '读取本地进程状态', required: true, candidates: [candidate('npm:monitor-process')], providerErrors: [] },
    { id: 'waiter', label: '持久等待恢复', query: '持久等待并恢复会话', required: true, candidates: [candidate('npm:plugin-monitors')], providerErrors: [] },
    { id: 'delivery', label: '飞书通知', query: '发送结果到飞书', required: true, candidates: [candidate('npm:lark-bot')], providerErrors: [] },
  ]
  const selections = roles.map(role => ({ roleId: role.id, candidateIdentities: [role.candidates[0].identity] }))
  const solutions = roles.map(role => ({ ...role.candidates[0], roleIds: [role.id] }))
  return {
    id: scenario.id,
    final_text: '三个职责均已完整覆盖。',
    activities: [
      {
        name: 'dsh / plugin_discover', status: 'completed', input: { action: 'search_roles', query: 'task' },
        output: { solutionId: 'solution-1', status: 'needs_review', roles, ambiguities: [] },
      },
      {
        name: 'dsh / plugin_discover', status: 'completed', input: { action: 'assess_solution', solutionId: 'solution-1', selections },
        output: {
          solutionId: 'solution-1', status: 'complete', ambiguities: [], roles: roles.map((role, index) => ({ ...role, status: 'covered', primaryCandidateIdentity: selections[index].candidateIdentities[0] })),
          solutions, coverage: { requiredRoles: 3, coveredRequiredRoles: 3, missingRequiredRoleIds: [], complete: true },
        },
      },
    ],
  }
}

test('accepts one resolved, non-redundant solution for every required role with directory participation', () => {
  assert.deepEqual(evaluateDshTaskSolutionScenario(scenario, fixture()).failures, [])
})

test('rejects incomplete, padded, mutation-bearing conversations', () => {
  const value = fixture()
  value.activities.at(-1).output.status = 'incomplete'
  value.activities.at(-1).output.coverage.complete = false
  value.activities.at(-1).input.selections[0].candidateIdentities.push('npm:padding')
  value.activities.push({ name: 'dsh / plugin_manage', status: 'completed', input: { action: 'plan' }, output: {} })
  const evaluation = evaluateDshTaskSolutionScenario(scenario, value)
  assert.equal(evaluation.passed, false)
  assert(evaluation.failures.some(message => message.includes('complete assessment')))
  assert(evaluation.failures.some(message => message.includes('no padding')))
  assert(evaluation.failures.some(message => message.includes('plugin_manage')))
})
