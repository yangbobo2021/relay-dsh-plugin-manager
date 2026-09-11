import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  evaluateTaskRoleModelPlans,
  validateTaskRoleModelSuite,
} from '../scripts/task-role-model-evaluation.mjs'

const suite = JSON.parse(await readFile(new URL('../fixtures/evaluation/task-role-model-scenarios.v1.json', import.meta.url), 'utf8'))
const locales = ['zh-CN', 'en']

function passingOutput() {
  return {
    plans: suite.cases.flatMap(scenario => locales.map(locale => ({
      scenario_id: scenario.scenario_id,
      locale,
      roles: scenario.expected_roles.map(role => ({
        id: role.key,
        label: role.match_any[0],
        query: `${role.match_any[0]} plugin`,
        required: role.required,
      })),
      ambiguities: scenario.expected_ambiguities.map(ambiguity => ({
        id: ambiguity.key,
        question: ambiguity.match_any[0],
        options: ['option one', 'option two'],
      })),
    }))),
  }
}

function plan(output, scenarioId, locale = 'en') {
  return output.plans.find(item => item.scenario_id === scenarioId && item.locale === locale)
}

test('task-role model suite covers bilingual minimal roles, optional capability, ambiguity, and forbidden near-neighbour', () => {
  const validated = validateTaskRoleModelSuite(suite)
  assert.ok(validated.cases.length >= 5)
  assert.ok(validated.cases.some(scenario => scenario.expected_roles.some(role => role.required === false)))
  assert.ok(validated.cases.some(scenario => scenario.expected_ambiguities.length > 0))
  assert.ok(validated.cases.some(scenario => scenario.forbidden_role_match_any.length > 0))
})

test('task-role evaluator accepts exact bilingual semantic coverage', () => {
  const report = evaluateTaskRoleModelPlans(suite, passingOutput(), { model: 'fixture' })
  assert.equal(report.passed, true)
  assert.equal(report.metrics.plan_evaluations, suite.cases.length * locales.length)
  assert.equal(report.metrics.plan_passes, report.metrics.plan_evaluations)
  assert.equal(report.metrics.role_concept_passes, report.metrics.role_concept_checks)
  assert.equal(report.metrics.required_flag_passes, report.metrics.required_flag_checks)
  assert.equal(report.metrics.ambiguity_concept_passes, report.metrics.ambiguity_concept_checks)
})

test('task-role evaluator rejects merged or semantically missing roles', () => {
  const output = passingOutput()
  const target = plan(output, 'process-result-to-lark')
  target.roles = [{ id: 'one', label: 'process state and Lark', query: 'process state Lark', required: true }]
  const report = evaluateTaskRoleModelPlans(suite, output)
  const result = report.results.find(item => item.scenario_id === 'process-result-to-lark' && item.locale === 'en')
  assert.equal(result.passed, false)
  assert.ok(result.failures.some(failure => failure.code === 'role_count_mismatch'))
  assert.ok(result.failures.some(failure => failure.code === 'role_concept_missing'))
})

test('task-role evaluator rejects wrong optionality, missing ambiguity, and forbidden terminal role', () => {
  const output = passingOutput()
  plan(output, 'optional-monitor-dashboard').roles.find(role => role.id === 'monitor_dashboard').required = true
  plan(output, 'notification-channel-ambiguous').ambiguities = []
  plan(output, 'browse-workspace-files').roles[0] = {
    id: 'terminal', label: 'terminal workspace file browser', query: 'shell file preview', required: true,
  }
  const report = evaluateTaskRoleModelPlans(suite, output)
  assert.ok(report.results.find(item => item.scenario_id === 'optional-monitor-dashboard' && item.locale === 'en').failures.some(failure => failure.code === 'required_flag_mismatch'))
  assert.ok(report.results.find(item => item.scenario_id === 'notification-channel-ambiguous' && item.locale === 'en').failures.some(failure => failure.code === 'ambiguity_count_mismatch'))
  assert.ok(report.results.find(item => item.scenario_id === 'browse-workspace-files' && item.locale === 'en').failures.some(failure => failure.code === 'forbidden_role_present'))
})

test('task-role evaluator rejects missing, duplicate, and unexpected plans', () => {
  const missing = passingOutput()
  missing.plans.pop()
  assert.throws(() => evaluateTaskRoleModelPlans(suite, missing), /missing plan/u)

  const duplicate = passingOutput()
  duplicate.plans.push(structuredClone(duplicate.plans[0]))
  assert.throws(() => evaluateTaskRoleModelPlans(suite, duplicate), /duplicate plan/u)

  const unexpected = passingOutput()
  unexpected.plans[0].scenario_id = 'not-in-suite'
  assert.throws(() => evaluateTaskRoleModelPlans(suite, unexpected), /unexpected plan/u)
})
