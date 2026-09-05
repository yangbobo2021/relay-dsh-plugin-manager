import { describe, expect, it, vi } from 'vitest'
import { githubSearchProvider, npmSearchProvider, registrySearchProvider } from '../../src/providers.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('built-in search providers', () => {
  it('preserves an exact npm package query even when registry ranking omits it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      objects: [{ package: { name: 'different-plugin' }, score: { final: 1 } }],
    }), { status: 200 })) as unknown as typeof globalThis.fetch
    const provider = npmSearchProvider(fetch)
    const results = await provider.search({
      query: 'relay-dsh-plugin-codex', maxResults: 6, signal: new AbortController().signal,
    })
    expect(results[0]).toMatchObject({
      id: 'npm:relay-dsh-plugin-codex',
      sources: [{ kind: 'npm', package: 'relay-dsh-plugin-codex' }],
      evidence: ['Exact npm package-name query'],
    })
  })

  it('A-028 issues an exact owner query, verifies ownership, and emits structured evidence', async () => {
    const fetch = vi.fn(async () => json({
      items: [{
        id: 1,
        full_name: 'YangBobo2021/relay-dsh-plugin-codex',
        html_url: 'https://github.com/YangBobo2021/relay-dsh-plugin-codex',
        stargazers_count: 12,
      }, {
        id: 2,
        full_name: 'unrelated/not-owned',
        stargazers_count: 999,
      }],
    })) as unknown as typeof globalThis.fetch
    const results = await githubSearchProvider(fetch, {}).search({
      query: 'yangbobo2021',
      maxResults: 6,
      signal: new AbortController().signal,
      intent: { kind: 'github-owner', owner: 'yangbobo2021', fallbackToText: false },
    })

    const called = new URL(String(vi.mocked(fetch).mock.calls[0]![0]))
    expect(called.searchParams.get('q')).toBe('user:yangbobo2021 topic:dsh-plugin')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      sources: [{ kind: 'github', owner: 'YangBobo2021', repo: 'relay-dsh-plugin-codex' }],
      match: { kind: 'github-owner', value: 'yangbobo2021' },
      evidence: [
        'GitHub repository owner: YangBobo2021',
        'Exact GitHub owner query: yangbobo2021',
        'GitHub stars: 12',
      ],
    })
  })

  it('A-028 falls back to keyword search only for an empty inferred owner hint', async () => {
    const fetch = (vi.fn()
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ items: [{ full_name: 'example/tool2021', stargazers_count: 3 }] }))) as unknown as typeof globalThis.fetch
    const results = await githubSearchProvider(fetch, {}).search({
      query: 'tool2021',
      maxResults: 6,
      signal: new AbortController().signal,
      intent: { kind: 'github-owner', owner: 'tool2021', fallbackToText: true },
    })

    const calls = vi.mocked(fetch).mock.calls.map(call => new URL(String(call[0])).searchParams.get('q'))
    expect(calls).toEqual(['user:tool2021 topic:dsh-plugin', 'tool2021 topic:dsh-plugin'])
    expect(results[0]).not.toHaveProperty('match')
    expect(results[0]?.evidence).toEqual(['GitHub repository owner: example', 'GitHub stars: 3'])
  })

  it('A-028 does not turn an explicit missing owner into unrelated keyword results', async () => {
    const fetch = vi.fn(async () => json({ message: 'Validation Failed' }, 422)) as unknown as typeof globalThis.fetch
    const provider = githubSearchProvider(fetch, {})

    await expect(provider.search({
      query: 'missing-owner',
      maxResults: 6,
      signal: new AbortController().signal,
      intent: { kind: 'github-owner', owner: 'missing-owner', fallbackToText: false },
    })).rejects.toThrow(/HTTP 422/u)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('PM-025 consumes source-only Registry candidates and preserves local inspection', async () => {
    const fetch = vi.fn(async () => json({
      snapshot_id: 'discovery.awesome-dsh-plugin.2026-09-03.v1-0-2.abc123',
      candidates: [{
        entry: {
          entry_id: 'plugin.discovery.0123456789abcdef01234567',
          identity: {
            name: 'dsh-remote-mobile',
            repository_url: 'https://github.com/example/dsh-remote-mobile',
            repository_full_name: 'example/dsh-remote-mobile',
          },
          imported_content: {
            description: { 'zh-CN': '通过手机远程访问 DSH。', en: 'Remote mobile access for DSH.' },
            trust: 'untrusted_text',
          },
          sources: [
            { kind: 'npm', package_name: 'dsh-remote-mobile', spec: 'dsh-remote-mobile', exact: false },
            { kind: 'github', repository: 'example/dsh-remote-mobile', spec: 'github:example/dsh-remote-mobile', exact: false },
          ],
          resolution: { status: 'source_only' },
        },
        match: { score: 82.5, reason_codes: ['description_term_match'] },
      }],
      is_final_recommendation: false,
      grants_install_approval: false,
    })) as unknown as typeof globalThis.fetch
    const results = await registrySearchProvider('https://plugins.example.com', fetch).search({
      query: '手机远程访问', maxResults: 6, signal: new AbortController().signal,
    })
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]![0])).pathname).toBe('/v1/plugins:search')
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({
      schema_version: '1.0.0', query: '手机远程访问', locale: 'zh-CN', limit: 6,
    })
    expect(results[0]).toMatchObject({
      id: 'registry:plugin.discovery.0123456789abcdef01234567',
      sources: [
        { kind: 'npm', package: 'dsh-remote-mobile' },
        { kind: 'github', owner: 'example', repo: 'dsh-remote-mobile' },
      ],
      evidence: [
        'DSH Registry source snapshot: discovery.awesome-dsh-plugin.2026-09-03.v1-0-2.abc123',
        'Registry discovery record only; compatibility and security not tested',
        'Registry match: description_term_match',
      ],
    })
    expect(results[0]?.sources.every(source => source.kind === 'npm' ? source.version === undefined : source.ref === undefined)).toBe(true)
  })

  it('PM-025 requests English Registry content for a non-Chinese task', async () => {
    const fetch = vi.fn(async () => json({
      snapshot_id: 'discovery.source.2026-09-04.abc123',
      candidates: [],
    })) as unknown as typeof globalThis.fetch
    await registrySearchProvider('https://dsh-plugins.tech', fetch).search({
      query: 'browse workspace files', maxResults: 4, signal: new AbortController().signal,
    })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({
      query: 'browse workspace files', locale: 'en', limit: 4,
    })
  })

  it('PM-026 allows a built-in provider to fill the complete twenty-result page', async () => {
    const fetch = vi.fn(async () => json({
      snapshot_id: 'discovery.source.2026-09-05.abc123',
      candidates: [],
    })) as unknown as typeof globalThis.fetch
    await registrySearchProvider('https://dsh-plugins.tech', fetch).search({
      query: 'terminal', maxResults: 20, signal: new AbortController().signal,
    })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ limit: 20 })
  })

  it('PM-025 rejects insecure remote endpoints and malformed Registry authority fields', async () => {
    expect(() => registrySearchProvider('http://plugins.example.com')).toThrow(/HTTPS/u)
    const fetch = vi.fn(async () => json({ snapshot_id: 'bad', candidates: [] })) as unknown as typeof globalThis.fetch
    await expect(registrySearchProvider('http://127.0.0.1:4174', fetch).search({
      query: 'remote', maxResults: 6, signal: new AbortController().signal,
    })).rejects.toThrow(/invalid discovery response/u)
  })
})
