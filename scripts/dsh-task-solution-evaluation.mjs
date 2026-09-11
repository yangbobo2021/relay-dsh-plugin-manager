import assert from 'node:assert/strict'

function text(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase()
}

function containsAny(value, terms) {
  const normalized = text(value)
  return terms.some(term => normalized.includes(text(term)))
}

function activityAction(activity) {
  return activity?.input?.action
}

function candidateText(candidate) {
  return [candidate?.identity, candidate?.packageName, candidate?.repository, candidate?.description].join(' ')
}

export function validateDshTaskSolutionScenario(value) {
  assert(value && typeof value === 'object', 'DSH task-solution scenario must be an object.')
  assert(typeof value.id === 'string' && value.id !== '', 'Scenario id is required.')
  assert(typeof value.prompt === 'string' && value.prompt !== '', `Scenario ${value.id} requires a prompt.`)
  assert(Number.isInteger(value.exactRoleCount) && value.exactRoleCount > 0, `Scenario ${value.id} requires exactRoleCount.`)
  assert(Array.isArray(value.roles) && value.roles.length === value.exactRoleCount, `Scenario ${value.id} role expectations must match exactRoleCount.`)
  for (const role of value.roles) {
    assert(typeof role.key === 'string' && role.key !== '', `Scenario ${value.id} has an invalid role key.`)
    assert(Array.isArray(role.roleMatchAny) && role.roleMatchAny.length > 0, `Scenario ${value.id}/${role.key} requires roleMatchAny.`)
    assert(Array.isArray(role.solutionMatchAny) && role.solutionMatchAny.length > 0, `Scenario ${value.id}/${role.key} requires solutionMatchAny.`)
  }
  return value
}

export function evaluateDshTaskSolutionScenario(scenarioValue, result) {
  const scenario = validateDshTaskSolutionScenario(scenarioValue)
  const activities = Array.isArray(result?.activities) ? result.activities : []
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
    return condition
  }
  const discoverActivities = activities.filter(activity => typeof activityAction(activity) === 'string')
  const failedDiscoveries = discoverActivities.filter(activity => activity.status !== 'completed')
  const failedWorkflowCalls = failedDiscoveries.filter(activity => ['search_roles', 'assess_solution'].includes(activityAction(activity)))
  const roleSearches = discoverActivities.filter(activity => activity.status === 'completed' && activityAction(activity) === 'search_roles')
  const assessments = discoverActivities.filter(activity => activity.status === 'completed' && activityAction(activity) === 'assess_solution')
  const inspections = discoverActivities.filter(activity => activityAction(activity) === 'inspect')
  const mutations = activities.filter(activity => text(activity.name).includes('plugin_manage'))
  const search = roleSearches.at(-1)
  const assessment = assessments.at(-1)

  check(failedWorkflowCalls.length === 0, `search_roles/assess_solution produced ${failedWorkflowCalls.length} failed call(s).`)
  check(roleSearches.length === 1, `Expected exactly one completed search_roles call, received ${roleSearches.length}.`)
  check(assessments.length === 1, `Expected exactly one completed assess_solution call, received ${assessments.length}.`)
  check(inspections.length === 0, `search_roles already returns resolved candidates; received ${inspections.length} redundant inspect call(s).`)
  check(mutations.length === 0, 'Read-only discovery invoked plugin_manage.')
  if (search === undefined || assessment === undefined) {
    return { passed: failures.length === 0, failures, metrics: { tool_calls: activities.length } }
  }

  // DSH may truncate a large display payload even though the model received it
  // and assess_solution consumed its stored draft. The assessment repeats the
  // authoritative role plan, while search input preserves the authored query.
  const searchRoles = Array.isArray(search.output?.roles) ? search.output.roles
    : Array.isArray(assessment.output?.roles) ? assessment.output.roles
      : Array.isArray(search.input?.roles) ? search.input.roles : []
  const assessedRoles = Array.isArray(assessment.output?.roles) ? assessment.output.roles : []
  const selections = Array.isArray(assessment.input?.selections) ? assessment.input.selections : []
  const solutions = Array.isArray(assessment.output?.solutions) ? assessment.output.solutions : []
  check(typeof search.input?.query === 'string' && search.input.query.trim() !== '', 'search_roles omitted the complete task query.')
  check(searchRoles.length === scenario.exactRoleCount, `Expected ${scenario.exactRoleCount} role groups, received ${searchRoles.length}.`)
  check(searchRoles.every(role => typeof role.query === 'string' && role.query.length >= 1 && role.query.length <= 120), 'A role query was empty or exceeded 120 characters.')
  if (Array.isArray(search.output?.roles)) {
    check(searchRoles.every(role => !Array.isArray(role.providerErrors) || role.providerErrors.length === 0), 'A role search reported provider errors.')
  }
  check(assessment.output?.ambiguities?.length === 0, 'The explicit task unexpectedly retained an ambiguity.')
  if (typeof search.output?.solutionId === 'string') {
    check(assessment.input?.solutionId === search.output.solutionId, 'assess_solution did not use the search_roles solution id.')
  }
  check(assessment.output?.status === 'complete', `Expected complete assessment, received ${String(assessment.output?.status)}.`)
  check(assessment.output?.coverage?.complete === true, 'Required-role coverage is not complete.')
  check(assessment.output?.coverage?.requiredRoles === scenario.exactRoleCount, 'Required-role count differs from the scenario contract.')
  check(assessment.output?.coverage?.coveredRequiredRoles === scenario.exactRoleCount, 'Not every required role is covered.')
  check(assessment.output?.coverage?.missingRequiredRoleIds?.length === 0, 'Assessment still reports missing required roles.')
  check(selections.length === scenario.exactRoleCount, 'Assessment did not submit exactly one selection row per role.')
  check(solutions.length === scenario.exactRoleCount, `Expected ${scenario.exactRoleCount} globally minimal solutions, received ${solutions.length}.`)
  check(new Set(solutions.map(solution => solution.identity)).size === solutions.length, 'Assessment contains duplicate global solution identities.')

  const usedRoleIds = new Set()
  for (const expected of scenario.roles) {
    const matching = searchRoles.filter(role => !usedRoleIds.has(role.id)
      && containsAny(`${role.label} ${role.query}`, expected.roleMatchAny))
    if (!check(matching.length === 1, `Expected one distinct ${expected.key} role, received ${matching.length}.`)) continue
    const role = matching[0]
    usedRoleIds.add(role.id)
    check(role.required === true, `${expected.key} must be required.`)
    const selection = selections.find(item => item.roleId === role.id)
    const identities = Array.isArray(selection?.candidateIdentities) ? selection.candidateIdentities : []
    check(identities.length === 1, `${expected.key} must select exactly one primary solution and no padding.`)
    const identity = identities[0]
    check(containsAny(identity, expected.solutionMatchAny), `${expected.key} selected an unexpected solution: ${String(identity)}.`)
    const solution = solutions.find(item => item.identity === identity)
    const candidate = role.candidates?.find(item => item.identity === identity) ?? solution
    check(candidate !== undefined, `${expected.key} selection is not present in the assessed solution set.`)
    check(candidate !== undefined && containsAny(candidateText(candidate), expected.solutionMatchAny), `${expected.key} candidate evidence does not identify the expected capability.`)
    check(assessedRoles.some(item => item.id === role.id && item.status === 'covered' && item.primaryCandidateIdentity === identity), `${expected.key} was not assessed as covered by its selected primary.`)
  }
  check(usedRoleIds.size === scenario.exactRoleCount, 'Role expectations did not map one-to-one onto the authored plan.')
  check(typeof result.final_text === 'string' && result.final_text.trim() !== '', 'DSH session returned no final answer.')

  const directoryEvidencedCandidates = searchRoles.reduce((total, role) => total
    + (role.candidates ?? []).filter(candidate => Array.isArray(candidate.semanticMatches) && candidate.semanticMatches.length > 0).length, 0)

  return {
    passed: failures.length === 0,
    failures,
    metrics: {
      tool_calls: activities.length,
      plugin_discover_calls: discoverActivities.length,
      failed_plugin_discover_calls: failedDiscoveries.length,
      failed_workflow_calls: failedWorkflowCalls.length,
      search_roles_calls: roleSearches.length,
      inspect_calls: inspections.length,
      assess_solution_calls: assessments.length,
      authored_roles: searchRoles.length,
      selected_solutions: solutions.length,
      directory_evidenced_candidates: directoryEvidencedCandidates,
    },
  }
}

export function evaluateDshTaskSolutionRun(scenarios, results, metadata = {}) {
  const resultById = new Map(results.map(result => [result.id, result]))
  const evaluated = scenarios.map(scenario => {
    const result = resultById.get(scenario.id)
    if (result === undefined) return { id: scenario.id, passed: false, failures: ['Scenario result is missing.'], metrics: {} }
    return { id: scenario.id, ...evaluateDshTaskSolutionScenario(scenario, result) }
  })
  return {
    schema_version: '1.0.0',
    ...metadata,
    passed: evaluated.every(result => result.passed),
    results: evaluated,
  }
}
