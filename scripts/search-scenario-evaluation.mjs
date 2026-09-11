import assert from 'node:assert/strict'

const LOCALES = ['zh-CN', 'en']
const EXPECTED_KINDS = new Set(['npm_package', 'repository'])

function identityKey(expected) {
  return `${expected.kind}:${expected.value.toLowerCase()}`
}

function candidateIdentityKeys(candidate) {
  const identities = []
  const repository = repositoryName(candidate.repository)
  if (repository !== null) identities.push(`repository:${repository}`)
  if (typeof candidate.packageName === 'string' && candidate.packageName.trim() !== '') {
    identities.push(`npm_package:${candidate.packageName.toLowerCase()}`)
  }
  return identities
}

function duplicateCandidateIdentities(candidates) {
  const observed = new Map()
  for (const [index, candidate] of candidates.entries()) {
    for (const identity of candidateIdentityKeys(candidate)) {
      const ranks = observed.get(identity) ?? []
      ranks.push(index + 1)
      observed.set(identity, ranks)
    }
  }
  return [...observed.entries()]
    .filter(([, ranks]) => ranks.length > 1)
    .map(([identity, ranks]) => ({ identity, observed_ranks: ranks }))
}

function repositoryName(value) {
  if (typeof value !== 'string') return null
  return value.replace(/^https?:\/\//u, '').replace(/^github\.com\//u, '').replace(/\.git$/u, '').toLowerCase()
}

function matches(candidate, expected) {
  if (expected.kind === 'npm_package') return candidate.packageName?.toLowerCase() === expected.value.toLowerCase()
  return repositoryName(candidate.repository) === expected.value.toLowerCase()
}

function rankOf(candidates, expected) {
  const index = candidates.findIndex(candidate => matches(candidate, expected))
  return index < 0 ? null : index + 1
}

function validateExpected(expected, { rankRequired, roleRequired = false }) {
  assert(expected !== null && typeof expected === 'object' && !Array.isArray(expected), 'Expected identity must be an object.')
  assert(EXPECTED_KINDS.has(expected.kind), `Unsupported expected identity kind: ${String(expected.kind)}`)
  assert(typeof expected.value === 'string' && expected.value.trim() !== '', 'Expected identity requires a value.')
  if (rankRequired) assert(Number.isInteger(expected.max_rank) && expected.max_rank >= 1 && expected.max_rank <= 20, 'Expected identity requires max_rank from 1 to 20.')
  if (roleRequired) {
    assert(typeof expected.role === 'string' && /^[a-z][a-z0-9_]*$/u.test(expected.role), 'Required and forbidden expectations require a stable role.')
  }
}

export function validateSearchScenarioSuite(value) {
  assert(value?.schema_version === '1.0.0', 'Scenario suite schema_version must be 1.0.0.')
  assert(typeof value.suite_id === 'string' && value.suite_id.startsWith('plugin-manager-search.'), 'Scenario suite requires a stable suite_id.')
  assert(value.evaluation_unit === 'post_inspection_final_candidate_rank', 'Scenario suite must evaluate final post-inspection candidates.')
  assert(value.result_limit === 20, 'Scenario suite result_limit must remain 20.')
  assert(Array.isArray(value.cases) && value.cases.length >= 10, 'Scenario suite requires at least ten cases.')
  const ids = new Set()
  for (const scenario of value.cases) {
    assert(typeof scenario.scenario_id === 'string' && !ids.has(scenario.scenario_id), 'Scenario IDs must be non-empty and unique.')
    ids.add(scenario.scenario_id)
    assert(['single_plugin', 'plugin_composition'].includes(scenario.solution_scope), `Invalid solution scope for ${scenario.scenario_id}.`)
    for (const locale of LOCALES) assert(typeof scenario.task?.[locale] === 'string' && scenario.task[locale].trim() !== '', `${scenario.scenario_id} requires ${locale} task text.`)
    assert(Array.isArray(scenario.expected?.required) && scenario.expected.required.length > 0, `${scenario.scenario_id} requires at least one hard expectation.`)
    assert(Array.isArray(scenario.expected?.acceptable) && Array.isArray(scenario.expected?.forbidden), `${scenario.scenario_id} expectation arrays are incomplete.`)
    for (const expected of scenario.expected.required) validateExpected(expected, { rankRequired: true, roleRequired: true })
    for (const expected of scenario.expected.acceptable) validateExpected(expected, { rankRequired: false })
    for (const expected of scenario.expected.forbidden) validateExpected(expected, { rankRequired: true, roleRequired: true })
    const requiredRoles = scenario.expected.required.map(expected => expected.role)
    assert(new Set(requiredRoles).size === requiredRoles.length, `${scenario.scenario_id} assigns more than one required identity to the same solution role.`)
  }
  assert(Array.isArray(value.exact_queries) && value.exact_queries.length >= 2, 'Scenario suite requires exact-identifier regression cases.')
  for (const expected of value.exact_queries) {
    assert(typeof expected.query === 'string' && expected.query.trim() !== '', 'Exact query requires query text.')
    validateExpected(expected, { rankRequired: true })
  }
  assert(value.cases.some(item => item.solution_scope === 'plugin_composition'), 'Scenario suite must cover plugin composition.')
  assert(value.cases.some(item => item.expected.forbidden.length > 0), 'Scenario suite must cover forbidden near-neighbours.')
  assert(value.cases.some(item => item.expected.required.some(expected => expected.kind === 'repository')), 'Scenario suite must cover a GitHub-only identity.')
  return structuredClone(value)
}

export async function evaluateSearchScenarioSuite(inputSuite, search, metadata = {}) {
  const suite = validateSearchScenarioSuite(inputSuite)
  assert(typeof search === 'function', 'Scenario evaluation requires a search function.')
  const results = []
  for (const scenario of suite.cases) {
    for (const locale of LOCALES) {
      const query = scenario.task[locale]
      const response = await search(query, suite.result_limit)
      const required = scenario.expected.required.map(expected => {
        const rank = rankOf(response.candidates, expected)
        return { role: expected.role, identity: identityKey(expected), max_rank: expected.max_rank, observed_rank: rank, passed: rank !== null && rank <= expected.max_rank }
      })
      const acceptable = scenario.expected.acceptable.map(expected => {
        const rank = rankOf(response.candidates, expected)
        return { identity: identityKey(expected), observed_rank: rank, observed: rank !== null }
      })
      const forbidden = scenario.expected.forbidden.map(expected => {
        const rank = rankOf(response.candidates, expected)
        return { role: expected.role, identity: identityKey(expected), max_rank: expected.max_rank, observed_rank: rank, passed: rank === null || rank > expected.max_rank }
      })
      const duplicateIdentities = duplicateCandidateIdentities(response.candidates)
      const failures = [
        ...required.filter(check => !check.passed).map(check => ({ code: 'required_candidate_missing', ...check })),
        ...forbidden.filter(check => !check.passed).map(check => ({ code: 'forbidden_candidate_ranked', ...check })),
        ...duplicateIdentities.map(duplicate => ({ code: 'duplicate_solution_identity', ...duplicate })),
        ...(response.providerErrors?.some(error => error.provider === 'dsh-registry') === true
          ? [{ code: 'registry_provider_failed', errors: response.providerErrors.filter(error => error.provider === 'dsh-registry') }]
          : []),
      ]
      results.push({
        scenario_id: scenario.scenario_id,
        locale,
        query,
        solution_scope: scenario.solution_scope,
        passed: failures.length === 0,
        checks: { required, acceptable, forbidden, duplicate_identities: duplicateIdentities },
        failures,
        top_candidates: response.candidates.slice(0, 5).map(candidate => ({ rank: candidate.rank, package_name: candidate.packageName, repository: candidate.repository })),
      })
    }
  }
  const exact = []
  for (const expected of suite.exact_queries) {
    const response = await search(expected.query, suite.result_limit)
    const rank = rankOf(response.candidates, expected)
    exact.push({ query: expected.query, identity: identityKey(expected), max_rank: expected.max_rank, observed_rank: rank, passed: rank !== null && rank <= expected.max_rank })
  }
  const required = results.flatMap(result => result.checks.required)
  const forbidden = results.flatMap(result => result.checks.forbidden)
  const duplicateIdentities = results.flatMap(result => result.checks.duplicate_identities)
  const recallAt = limit => required.filter(check => check.observed_rank !== null && check.observed_rank <= limit).length / required.length
  const report = {
    schema_version: '1.0.0',
    suite_id: suite.suite_id,
    evaluation_unit: suite.evaluation_unit,
    generated_at: new Date().toISOString(),
    metadata,
    passed: results.every(result => result.passed) && exact.every(check => check.passed),
    metrics: {
      scenario_evaluations: results.length,
      scenario_passes: results.filter(result => result.passed).length,
      required_checks: required.length,
      required_passes: required.filter(check => check.passed).length,
      required_role_checks: required.length,
      required_role_passes: required.filter(check => check.passed).length,
      forbidden_checks: forbidden.length,
      forbidden_passes: forbidden.filter(check => check.passed).length,
      duplicate_identity_checks: results.length,
      duplicate_identity_failures: duplicateIdentities.length,
      exact_checks: exact.length,
      exact_passes: exact.filter(check => check.passed).length,
      required_recall_at_5: Number(recallAt(5).toFixed(6)),
      required_recall_at_10: Number(recallAt(10).toFixed(6)),
      required_recall_at_20: Number(recallAt(20).toFixed(6)),
      required_mean_reciprocal_rank: Number((required.reduce((sum, check) => sum + (check.observed_rank === null ? 0 : 1 / check.observed_rank), 0) / required.length).toFixed(6)),
    },
    results,
    exact,
  }
  return report
}

export function compareSearchScenarioReports(baseline, candidate) {
  assert(baseline?.suite_id === candidate?.suite_id, 'Search reports must use the same suite.')
  const baselineChecks = new Map(baseline.results.flatMap(result => [
    ...result.checks.required.map(check => [`${result.scenario_id}:${result.locale}:required:${check.identity}`, check]),
    ...result.checks.forbidden.map(check => [`${result.scenario_id}:${result.locale}:forbidden:${check.identity}`, check]),
  ]))
  const regressions = []
  for (const result of candidate.results) {
    for (const [kind, checks] of [['required', result.checks.required], ['forbidden', result.checks.forbidden]]) {
      for (const check of checks) {
        const key = `${result.scenario_id}:${result.locale}:${kind}:${check.identity}`
        const before = baselineChecks.get(key)
        if (before?.passed === true && check.passed !== true) regressions.push({ key, baseline_rank: before.observed_rank, candidate_rank: check.observed_rank })
      }
    }
  }
  const gates = {
    no_hard_check_regression: regressions.length === 0,
    scenario_passes_not_lower: candidate.metrics.scenario_passes >= baseline.metrics.scenario_passes,
    required_roles_all_covered: candidate.metrics.required_role_passes === candidate.metrics.required_role_checks,
    forbidden_passes_not_lower: candidate.metrics.forbidden_passes >= baseline.metrics.forbidden_passes,
    no_duplicate_solution_identity: candidate.metrics.duplicate_identity_failures === 0,
    exact_identifiers_all_pass: candidate.metrics.exact_passes === candidate.metrics.exact_checks,
    candidate_hard_gates_all_pass: candidate.passed,
  }
  return {
    passed: Object.values(gates).every(Boolean),
    gates,
    delta: {
      scenario_passes: candidate.metrics.scenario_passes - baseline.metrics.scenario_passes,
      required_role_passes: candidate.metrics.required_role_passes - baseline.metrics.required_role_passes,
      required_passes: candidate.metrics.required_passes - baseline.metrics.required_passes,
      forbidden_passes: candidate.metrics.forbidden_passes - baseline.metrics.forbidden_passes,
      required_recall_at_10: Number((candidate.metrics.required_recall_at_10 - baseline.metrics.required_recall_at_10).toFixed(6)),
      required_mean_reciprocal_rank: Number((candidate.metrics.required_mean_reciprocal_rank - baseline.metrics.required_mean_reciprocal_rank).toFixed(6)),
    },
    regressions,
  }
}
