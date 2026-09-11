import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

import { registrySearchProvider } from '../src/providers.ts'
import { searchPlugins } from '../src/search.ts'
import { compareSearchScenarioReports, evaluateSearchScenarioSuite } from './search-scenario-evaluation.mjs'

const origin = process.env.DSH_PLUGIN_REGISTRY_URL?.trim() || 'https://dsh-plugins.tech'
const identityOnly = process.env.DSH_PLUGIN_SEARCH_IDENTITY_ONLY === '1'
const provider = registrySearchProvider(origin)
const runtime = { entries: () => [provider] }
const suite = JSON.parse(await readFile(new URL('../fixtures/evaluation/search-scenarios.v1.json', import.meta.url), 'utf8'))

const healthResponse = await fetch(new URL('/healthz', origin), {
  signal: AbortSignal.timeout(15_000),
})
assert.equal(healthResponse.status, 200)
const health = await healthResponse.json()
assert.equal(health.status, 'ok')
assert.equal(health.data_class, 'public')
assert.ok(health.discovery?.entries >= 3_000)

async function rawSearch(query, locale) {
  const response = await fetch(new URL('/v1/plugins:search', origin), {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ schema_version: '1.0.0', query, locale, limit: 5 }),
  })
  assert.equal(response.status, 200)
  return await response.json()
}

const authority = await rawSearch('管理插件', 'zh-CN')
assert.match(authority.snapshot_id, /^discovery\./u)
assert.equal(authority.is_final_recommendation, false)
assert.equal(authority.grants_install_approval, false)
assert.ok(authority.candidates.length > 0)
assert.ok(authority.candidates.every(candidate =>
  candidate.entry?.imported_content?.trust === 'untrusted_text'
  && candidate.entry?.resolution?.status === 'source_only'
  && candidate.entry?.sources?.every(source => source.exact === false)))

const routeResponse = await fetch(new URL('/v1/plugins:route', origin), {
  method: 'POST',
  signal: AbortSignal.timeout(20_000),
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify({ schema_version: '1.0.0', query: '管理插件', locale: 'zh-CN', limit: 5 }),
})
assert.equal(routeResponse.status, 200)
const routeAuthority = await routeResponse.json()
assert.match(routeAuthority.directory_version, /^[a-z0-9][a-z0-9._-]+$/u)
assert.equal(routeAuthority.snapshot_id, authority.snapshot_id)
assert.equal(routeAuthority.is_final_recommendation, false)
assert.equal(routeAuthority.grants_install_approval, false)

const scenarios = [
  { query: '管理插件', expected: 'dsh-plugin-manager' },
  { query: 'workspace files', expected: 'dsh-workspace-files' },
  { query: 'dsh-plugin-manager', expected: 'dsh-plugin-manager' },
]
const observed = []
for (const scenario of identityOnly ? [] : scenarios) {
  const result = await searchPlugins(runtime, scenario.query, {
    maxResults: 5,
    providerTimeoutMs: 20_000,
  })
  assert.deepEqual(result.providerErrors, [])
  assert.ok(result.candidates.some(candidate => candidate.packageName === scenario.expected))
  assert.ok(result.candidates.every(candidate =>
    candidate.providers.includes('dsh-registry')
    && /(?:@[0-9]+\.[0-9]+\.[0-9]+|#[0-9a-f]{40})$/u.test(candidate.recommendedSource)))
  observed.push({
    query: scenario.query,
    candidates: result.candidates.map(candidate => candidate.packageName),
    rejected_candidates: result.rejectedCandidates,
  })
}

const empty = await searchPlugins(runtime, 'zzzz-no-such-plugin-74f81e', {
  maxResults: 5,
  providerTimeoutMs: 20_000,
})
assert.deepEqual(empty.candidates, [])
assert.deepEqual(empty.providerErrors, [])

function trackedRegistryFetch(sourceMap) {
  return async (input, init) => {
    const response = await fetch(input, init)
    if (response.ok) {
      const data = await response.clone().json()
      for (const candidate of data.candidates ?? []) {
        const entry = candidate.entry
        if (entry?.identity === undefined || !Array.isArray(entry.sources)) continue
        for (const source of entry.sources) {
          const key = source.kind === 'npm' ? `npm:${source.package_name}` : source.kind === 'github' ? `github:${source.repository.toLowerCase()}` : null
          if (key !== null) sourceMap.set(key, entry)
        }
      }
    }
    return response
  }
}

function registryIdentityInspector(sourceMap) {
  return async source => {
    const key = source.kind === 'npm' ? `npm:${source.package}` : `github:${source.owner.toLowerCase()}/${source.repo.toLowerCase()}`
    const entry = sourceMap.get(key)
    if (entry === undefined) throw new Error(`No Registry identity was recorded for ${key}`)
    const repository = entry.identity.repository_full_name.toLowerCase()
    const packageName = entry.identity.npm_package ?? entry.identity.name
    if (source.kind === 'npm') {
      return {
        source: { ...source, version: '0.0.0' }, sourceType: 'npm', requestedSpec: source.package,
        installSpec: `${source.package}@0.0.0`, packageName, version: '0.0.0', integrity: 'sha512-evaluation',
        repository: `github.com/${repository}`, description: entry.imported_content.description.en,
        bundlePatch: './cordis.patch.yml', client: false, peerDependencies: {},
      }
    }
    return {
      source: { ...source, ref: '0'.repeat(40) }, sourceType: 'github', requestedSpec: `github:${source.owner}/${source.repo}`,
      installSpec: `github:${source.owner}/${source.repo}#${'0'.repeat(40)}`, packageName, commit: '0'.repeat(40),
      repository: `github.com/${repository}`, description: entry.imported_content.description.en,
      bundlePatch: './cordis.patch.yml', client: false, peerDependencies: {},
    }
  }
}

async function scenarioReport(strategy) {
  const sourceMap = new Map()
  const scenarioProvider = registrySearchProvider(origin, trackedRegistryFetch(sourceMap), { strategy })
  return evaluateSearchScenarioSuite(suite, (query, maxResults) => searchPlugins(
    { entries: () => [scenarioProvider] },
    query,
    { maxResults, providerTimeoutMs: 25_000, inspect: registryIdentityInspector(sourceMap) },
  ), {
    strategy,
    registry_origin: origin,
    registry_release: health.release,
    snapshot_id: authority.snapshot_id,
    directory_version: strategy === 'hybrid' ? routeAuthority.directory_version : null,
    inspection: 'registry-identity simulation; immutable source smoke is reported separately',
  })
}

const baseline = await scenarioReport('keyword')
const candidate = await scenarioReport('hybrid')
const comparison = compareSearchScenarioReports(baseline, candidate)

const acceptanceReport = {
  schema_version: '1.0.0',
  suite_id: suite.suite_id,
  registry_origin: origin,
  registry_release: health.release,
  snapshot_id: authority.snapshot_id,
  directory_version: routeAuthority.directory_version,
  baseline: { passed: baseline.passed, metrics: baseline.metrics },
  candidate: { passed: candidate.passed, metrics: candidate.metrics },
  comparison,
  candidate_failures: candidate.results.filter(result => !result.passed),
}
const output = process.env.DSH_PLUGIN_SEARCH_ACCEPTANCE_OUTPUT?.trim()
if (output) await writeFile(output, `${JSON.stringify(acceptanceReport, null, 2)}\n`)
assert.equal(comparison.passed, true, JSON.stringify({ comparison, failures: candidate.results.filter(result => !result.passed) }, null, 2))

process.stdout.write(`${JSON.stringify({
  registry_origin: origin,
  release: health.release,
  snapshot_id: health.discovery.snapshot_id,
  discovery_entries: health.discovery.entries,
  authority: {
    is_final_recommendation: authority.is_final_recommendation,
    grants_install_approval: authority.grants_install_approval,
  },
  immutable_source_smoke: identityOnly ? 'skipped_by_operator' : 'passed',
  directory_version: routeAuthority.directory_version,
  scenarios: observed,
  search_acceptance: acceptanceReport,
  empty_query: empty.query,
}, null, 2)}\n`)
