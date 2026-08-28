import { describe, expect, it, vi } from 'vitest'
import { githubSearchProvider, npmSearchProvider } from '../../src/providers.ts'

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
})
