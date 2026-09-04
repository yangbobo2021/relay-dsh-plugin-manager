import assert from 'node:assert/strict'

import { registrySearchProvider } from '../src/providers.ts'
import { searchPlugins } from '../src/search.ts'

const origin = process.env.DSH_PLUGIN_REGISTRY_URL?.trim() || 'https://dsh-plugins.tech'
const provider = registrySearchProvider(origin)
const runtime = { entries: () => [provider] }

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

const scenarios = [
  { query: '管理插件', expected: 'dsh-plugin-manager' },
  { query: 'workspace files', expected: 'dsh-workspace-files' },
  { query: 'dsh-plugin-manager', expected: 'dsh-plugin-manager' },
]
const observed = []
for (const scenario of scenarios) {
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

process.stdout.write(`${JSON.stringify({
  registry_origin: origin,
  release: health.release,
  snapshot_id: health.discovery.snapshot_id,
  discovery_entries: health.discovery.entries,
  authority: {
    is_final_recommendation: authority.is_final_recommendation,
    grants_install_approval: authority.grants_install_approval,
  },
  scenarios: observed,
  empty_query: empty.query,
}, null, 2)}\n`)
