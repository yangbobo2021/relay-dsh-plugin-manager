import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  compareSearchScenarioReports,
  evaluateSearchScenarioSuite,
  validateSearchScenarioSuite,
} from '../scripts/search-scenario-evaluation.mjs'

const suite = JSON.parse(await readFile(new URL('../fixtures/evaluation/search-scenarios.v1.json', import.meta.url), 'utf8'))

function candidate(packageName, repository = `github.com/example/${packageName.replace('@', '').replace('/', '-')}`) {
  return { rank: 1, packageName, repository }
}

test('A-035 suite covers bilingual, composition, negative-pair, third-party, GitHub-only, and exact cases', () => {
  const validated = validateSearchScenarioSuite(suite)
  assert.ok(validated.cases.length >= 10)
  assert.ok(validated.coverage.includes('bilingual_task_wording'))
  assert.ok(validated.cases.some(item => item.solution_scope === 'plugin_composition'))
  assert.ok(validated.cases.some(item => item.expected.forbidden.length > 0))
  assert.ok(validated.cases.some(item => item.expected.required.some(expected => expected.kind === 'repository')))
  assert.ok(validated.exact_queries.length >= 2)
})

test('A-035 evaluates the final candidate rank and requires every composition member', async () => {
  const small = structuredClone(suite)
  small.cases = [
    suite.cases.find(item => item.scenario_id === 'observe-process-composition'),
    suite.cases.find(item => item.scenario_id === 'review-git-diff'),
  ]
  small.cases.push(...suite.cases.filter(item => !['observe-process-composition', 'review-git-diff'].includes(item.scenario_id)).slice(0, 8))
  small.exact_queries = suite.exact_queries.slice(0, 2)
  const report = await evaluateSearchScenarioSuite(small, async query => ({
    candidates: query.includes('程序') || query.includes('process')
      ? [candidate('relay-dsh-plugin-monitors')]
      : [candidate('relay-dsh-plugin-codex'), candidate('relay-dsh-plugin-manager'), candidate('dsh-budget')],
    providerErrors: [],
  }))
  const composition = report.results.filter(item => item.scenario_id === 'observe-process-composition')
  assert.equal(composition.length, 2)
  assert.ok(composition.every(item => item.failures.some(failure => failure.identity === 'npm_package:relay-dsh-plugin-monitor-process')))
  assert.equal(report.passed, false)
})

test('A-035 comparison rejects a hard-check regression even when aggregate counts tie', () => {
  const baseResult = (required, forbidden) => ({
    scenario_id: 'one', locale: 'en',
    checks: { required: [{ role: 'one_role', identity: 'npm_package:one', observed_rank: required ? 1 : null, passed: required }], acceptable: [], forbidden: [{ role: 'wrong_role', identity: 'npm_package:two', observed_rank: forbidden ? null : 1, passed: forbidden }], duplicate_identities: [] },
  })
  const metrics = { scenario_passes: 1, required_passes: 1, required_role_passes: 1, required_role_checks: 1, forbidden_passes: 1, duplicate_identity_failures: 0, required_recall_at_10: 1, required_mean_reciprocal_rank: 1, exact_passes: 1, exact_checks: 1 }
  const baseline = { suite_id: 'same', metrics, results: [baseResult(true, true)] }
  const candidateReport = { suite_id: 'same', passed: false, metrics, results: [baseResult(false, true)] }
  const comparison = compareSearchScenarioReports(baseline, candidateReport)
  assert.equal(comparison.passed, false)
  assert.equal(comparison.gates.no_hard_check_regression, false)
  assert.equal(comparison.regressions.length, 1)
})

test('A-035 rejects npm aliases that resolve to the same repository identity', async () => {
  const report = await evaluateSearchScenarioSuite(suite, async () => ({
    candidates: [
      candidate('first-package', 'github.com/example/shared-plugin'),
      candidate('second-package', 'https://github.com/example/shared-plugin.git'),
    ],
    providerErrors: [],
  }))
  assert.equal(report.passed, false)
  assert.ok(report.results.every(result => result.failures.some(failure => failure.code === 'duplicate_solution_identity')))
  assert.ok(report.metrics.duplicate_identity_failures >= report.metrics.scenario_evaluations)
})
