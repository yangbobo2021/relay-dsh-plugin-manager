import { describe, expect, it, vi } from 'vitest'
import { npmSearchProvider } from '../../src/providers.ts'

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
})
