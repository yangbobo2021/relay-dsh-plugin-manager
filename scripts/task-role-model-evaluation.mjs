import assert from 'node:assert/strict'

const LOCALES = ['zh-CN', 'en']

function nonEmptyString(value, message) {
  assert(typeof value === 'string' && value.trim() !== '', message)
}

function normalized(value) {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[‐‑‒–—]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
}

function containsAny(text, phrases) {
  const haystack = normalized(text)
  return phrases.some(phrase => haystack.includes(normalized(phrase)))
}

function findDistinctMatches(expected, observed, expectedText, observedText) {
  const candidates = expected.map(item => observed
    .map((value, index) => ({ index, value }))
    .filter(({ value }) => containsAny(observedText(value), expectedText(item)))
    .map(({ index }) => index))

  const expectedByObserved = new Array(observed.length).fill(null)
  function augment(expectedIndex, visited) {
    for (const observedIndex of candidates[expectedIndex]) {
      if (visited.has(observedIndex)) continue
      visited.add(observedIndex)
      const previousExpected = expectedByObserved[observedIndex]
      if (previousExpected === null || augment(previousExpected, visited)) {
        expectedByObserved[observedIndex] = expectedIndex
        return true
      }
    }
    return false
  }
  for (const expectedIndex of candidates
    .map((_, index) => index)
    .sort((left, right) => candidates[left].length - candidates[right].length || left - right)) {
    augment(expectedIndex, new Set())
  }
  const observedByExpected = new Array(expected.length).fill(null)
  expectedByObserved.forEach((expectedIndex, observedIndex) => {
    if (expectedIndex !== null) observedByExpected[expectedIndex] = observedIndex
  })
  return observedByExpected
}

function roleText(role) {
  return `${role.id} ${role.label} ${role.query}`
}

function ambiguityText(ambiguity) {
  return `${ambiguity.id} ${ambiguity.question} ${ambiguity.options.join(' ')}`
}

function validateExpectedConcept(value, message, { requiredFlag = false } = {}) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${message} must be an object.`)
  nonEmptyString(value.key, `${message} requires a key.`)
  if (requiredFlag) assert(typeof value.required === 'boolean', `${message} requires a boolean required flag.`)
  assert(Array.isArray(value.match_any) && value.match_any.length > 0, `${message} requires match_any phrases.`)
  for (const phrase of value.match_any) nonEmptyString(phrase, `${message} contains an empty match phrase.`)
}

export function validateTaskRoleModelSuite(value) {
  assert(value?.schema_version === '1.0.0', 'Task-role suite schema_version must be 1.0.0.')
  assert(typeof value.suite_id === 'string' && value.suite_id.startsWith('plugin-manager-task-role-model.'), 'Task-role suite requires a stable suite_id.')
  assert(value.evaluation_unit === 'model_authored_role_plan', 'Task-role suite must evaluate model-authored role plans.')
  assert(Array.isArray(value.cases) && value.cases.length >= 5, 'Task-role suite requires at least five cases.')

  const scenarioIds = new Set()
  for (const scenario of value.cases) {
    nonEmptyString(scenario.scenario_id, 'Each task-role scenario requires an ID.')
    assert(!scenarioIds.has(scenario.scenario_id), `Duplicate task-role scenario ID: ${scenario.scenario_id}`)
    scenarioIds.add(scenario.scenario_id)
    for (const locale of LOCALES) nonEmptyString(scenario.task?.[locale], `${scenario.scenario_id} requires ${locale} task text.`)
    assert(Array.isArray(scenario.expected_roles) && scenario.expected_roles.length > 0, `${scenario.scenario_id} requires expected roles.`)
    assert(Number.isInteger(scenario.exact_role_count) && scenario.exact_role_count === scenario.expected_roles.length, `${scenario.scenario_id} exact_role_count must equal expected_roles length.`)
    assert(Array.isArray(scenario.expected_ambiguities), `${scenario.scenario_id} requires expected_ambiguities.`)
    assert(Array.isArray(scenario.forbidden_role_match_any), `${scenario.scenario_id} requires forbidden_role_match_any.`)

    const roleKeys = new Set()
    for (const role of scenario.expected_roles) {
      validateExpectedConcept(role, `${scenario.scenario_id} expected role`, { requiredFlag: true })
      assert(!roleKeys.has(role.key), `${scenario.scenario_id} has duplicate expected role key: ${role.key}`)
      roleKeys.add(role.key)
    }
    const ambiguityKeys = new Set()
    for (const ambiguity of scenario.expected_ambiguities) {
      validateExpectedConcept(ambiguity, `${scenario.scenario_id} expected ambiguity`)
      assert(!ambiguityKeys.has(ambiguity.key), `${scenario.scenario_id} has duplicate expected ambiguity key: ${ambiguity.key}`)
      ambiguityKeys.add(ambiguity.key)
    }
    for (const phrase of scenario.forbidden_role_match_any) nonEmptyString(phrase, `${scenario.scenario_id} contains an empty forbidden role phrase.`)
  }
  return structuredClone(value)
}

function validateModelOutput(output) {
  assert(output !== null && typeof output === 'object' && !Array.isArray(output), 'Model output must be an object.')
  assert(Array.isArray(output.plans), 'Model output requires a plans array.')
  for (const [planIndex, plan] of output.plans.entries()) {
    nonEmptyString(plan?.scenario_id, `Plan ${planIndex} requires scenario_id.`)
    assert(LOCALES.includes(plan.locale), `Plan ${planIndex} has unsupported locale.`)
    assert(Array.isArray(plan.roles) && plan.roles.length >= 1 && plan.roles.length <= 8, `Plan ${planIndex} requires 1-8 roles.`)
    assert(Array.isArray(plan.ambiguities) && plan.ambiguities.length <= 4, `Plan ${planIndex} requires 0-4 ambiguities.`)
    const roleIds = new Set()
    for (const role of plan.roles) {
      nonEmptyString(role?.id, `Plan ${planIndex} role requires id.`)
      nonEmptyString(role.label, `Plan ${planIndex} role requires label.`)
      nonEmptyString(role.query, `Plan ${planIndex} role requires query.`)
      assert(typeof role.required === 'boolean', `Plan ${planIndex} role requires a boolean required flag.`)
      assert(!roleIds.has(role.id), `Plan ${planIndex} contains duplicate role ID: ${role.id}`)
      roleIds.add(role.id)
    }
    const ambiguityIds = new Set()
    for (const ambiguity of plan.ambiguities) {
      nonEmptyString(ambiguity?.id, `Plan ${planIndex} ambiguity requires id.`)
      nonEmptyString(ambiguity.question, `Plan ${planIndex} ambiguity requires question.`)
      assert(Array.isArray(ambiguity.options) && ambiguity.options.length >= 2 && ambiguity.options.length <= 8, `Plan ${planIndex} ambiguity requires 2-8 options.`)
      for (const option of ambiguity.options) nonEmptyString(option, `Plan ${planIndex} ambiguity contains an empty option.`)
      assert(!ambiguityIds.has(ambiguity.id), `Plan ${planIndex} contains duplicate ambiguity ID: ${ambiguity.id}`)
      ambiguityIds.add(ambiguity.id)
    }
  }
}

export function evaluateTaskRoleModelPlans(inputSuite, modelOutput, metadata = {}) {
  const suite = validateTaskRoleModelSuite(inputSuite)
  validateModelOutput(modelOutput)

  const expectedPlanKeys = new Set(suite.cases.flatMap(scenario => LOCALES.map(locale => `${scenario.scenario_id}:${locale}`)))
  const plans = new Map()
  for (const plan of modelOutput.plans) {
    const key = `${plan.scenario_id}:${plan.locale}`
    assert(expectedPlanKeys.has(key), `Model output contains an unexpected plan: ${key}`)
    assert(!plans.has(key), `Model output contains a duplicate plan: ${key}`)
    plans.set(key, plan)
  }
  for (const key of expectedPlanKeys) assert(plans.has(key), `Model output is missing plan: ${key}`)

  const results = []
  for (const scenario of suite.cases) {
    for (const locale of LOCALES) {
      const plan = plans.get(`${scenario.scenario_id}:${locale}`)
      const roleMatches = findDistinctMatches(
        scenario.expected_roles,
        plan.roles,
        expected => [...expected.match_any, expected.key],
        roleText,
      )
      const roles = scenario.expected_roles.map((expected, expectedIndex) => {
        const observedIndex = roleMatches[expectedIndex]
        const observed = observedIndex === null ? null : plan.roles[observedIndex]
        return {
          key: expected.key,
          expected_required: expected.required,
          observed_role_id: observed?.id ?? null,
          concept_matched: observed !== null,
          required_flag_matched: observed?.required === expected.required,
          passed: observed !== null && observed.required === expected.required,
        }
      })
      const ambiguityMatches = findDistinctMatches(
        scenario.expected_ambiguities,
        plan.ambiguities,
        expected => [...expected.match_any, expected.key],
        ambiguityText,
      )
      const ambiguities = scenario.expected_ambiguities.map((expected, expectedIndex) => {
        const observedIndex = ambiguityMatches[expectedIndex]
        return {
          key: expected.key,
          observed_ambiguity_id: observedIndex === null ? null : plan.ambiguities[observedIndex].id,
          passed: observedIndex !== null,
        }
      })
      const forbidden = scenario.forbidden_role_match_any.map(phrase => ({
        phrase,
        observed_role_ids: plan.roles.filter(role => containsAny(roleText(role), [phrase])).map(role => role.id),
      })).map(check => ({ ...check, passed: check.observed_role_ids.length === 0 }))
      const roleCount = {
        expected: scenario.exact_role_count,
        observed: plan.roles.length,
        passed: plan.roles.length === scenario.exact_role_count,
      }
      const ambiguityCount = {
        expected: scenario.expected_ambiguities.length,
        observed: plan.ambiguities.length,
        passed: plan.ambiguities.length === scenario.expected_ambiguities.length,
      }
      const failures = [
        ...(!roleCount.passed ? [{ code: 'role_count_mismatch', ...roleCount }] : []),
        ...roles.filter(check => !check.concept_matched).map(check => ({ code: 'role_concept_missing', key: check.key })),
        ...roles.filter(check => check.concept_matched && !check.required_flag_matched).map(check => ({ code: 'required_flag_mismatch', key: check.key, expected_required: check.expected_required, observed_role_id: check.observed_role_id })),
        ...forbidden.filter(check => !check.passed).map(check => ({ code: 'forbidden_role_present', phrase: check.phrase, observed_role_ids: check.observed_role_ids })),
        ...(!ambiguityCount.passed ? [{ code: 'ambiguity_count_mismatch', ...ambiguityCount }] : []),
        ...ambiguities.filter(check => !check.passed).map(check => ({ code: 'ambiguity_concept_missing', key: check.key })),
      ]
      results.push({
        scenario_id: scenario.scenario_id,
        locale,
        task: scenario.task[locale],
        passed: failures.length === 0,
        checks: { role_count: roleCount, roles, forbidden, ambiguity_count: ambiguityCount, ambiguities },
        failures,
        observed_plan: plan,
      })
    }
  }

  const roleChecks = results.flatMap(result => result.checks.roles)
  const forbiddenChecks = results.flatMap(result => result.checks.forbidden)
  const ambiguityChecks = results.flatMap(result => result.checks.ambiguities)
  const report = {
    schema_version: '1.0.0',
    suite_id: suite.suite_id,
    evaluation_unit: suite.evaluation_unit,
    generated_at: new Date().toISOString(),
    metadata,
    passed: results.every(result => result.passed),
    metrics: {
      plan_evaluations: results.length,
      plan_passes: results.filter(result => result.passed).length,
      role_count_checks: results.length,
      role_count_passes: results.filter(result => result.checks.role_count.passed).length,
      role_concept_checks: roleChecks.length,
      role_concept_passes: roleChecks.filter(check => check.concept_matched).length,
      required_flag_checks: roleChecks.length,
      required_flag_passes: roleChecks.filter(check => check.required_flag_matched).length,
      forbidden_checks: forbiddenChecks.length,
      forbidden_passes: forbiddenChecks.filter(check => check.passed).length,
      ambiguity_count_checks: results.length,
      ambiguity_count_passes: results.filter(result => result.checks.ambiguity_count.passed).length,
      ambiguity_concept_checks: ambiguityChecks.length,
      ambiguity_concept_passes: ambiguityChecks.filter(check => check.passed).length,
    },
    results,
  }
  return report
}
