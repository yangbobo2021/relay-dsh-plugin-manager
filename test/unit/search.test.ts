import { describe, expect, it } from 'vitest'
import { searchPlugins } from '../../src/search.ts'
import type { PluginSearchProvider } from '../../src/search-runtime.ts'
import type { PluginInspection, PluginSource } from '../../src/source.ts'

function inspection(source: PluginSource): PluginInspection {
  if (source.kind === 'npm') {
    return {
      source: { ...source, version: '1.0.0' }, sourceType: 'npm', requestedSpec: source.package,
      installSpec: `${source.package}@1.0.0`, packageName: source.package, version: '1.0.0',
      integrity: 'sha512-YQ==', repository: 'github.com/example/shared', description: 'shared',
      bundlePatch: './cordis.patch.yml', client: false, peerDependencies: {},
    }
  }
  return {
    source: { ...source, ref: 'a'.repeat(40) }, sourceType: 'github', requestedSpec: `github:${source.owner}/${source.repo}`,
    installSpec: `github:${source.owner}/${source.repo}#${'a'.repeat(40)}`, packageName: 'shared-plugin',
    commit: 'a'.repeat(40), repository: 'github.com/example/shared', description: 'shared',
    bundlePatch: './cordis.patch.yml', client: false, peerDependencies: {},
  }
}

describe('PM-004/PM-005 search orchestration', () => {
  it('isolates provider errors, inspects results, deduplicates aliases, and recommends npm', async () => {
    const providers: PluginSearchProvider[] = [{
      id: 'catalog',
      search: async () => [{
        id: 'one', title: 'shared', score: 2,
        sources: [{ kind: 'npm', package: 'shared-plugin' }, { kind: 'github', owner: 'example', repo: 'shared' }],
        evidence: ['curated'],
      }],
    }, {
      id: 'broken',
      search: async () => { throw new Error('catalog offline') },
    }]
    const result = await searchPlugins({ entries: () => providers }, 'shared', {
      inspect: async source => inspection(typeof source === 'string' ? { kind: 'npm', package: source } : source),
    })
    expect(result.providerErrors).toEqual([{ provider: 'broken', error: 'catalog offline' }])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      identity: 'github.com/example/shared',
      recommendedSource: 'shared-plugin@1.0.0',
    })
    expect(result.candidates[0]?.sources).toHaveLength(2)
  })

  it('times out one provider without blocking a healthy sibling', async () => {
    const providers: PluginSearchProvider[] = [{
      id: 'slow',
      search: request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })),
    }, {
      id: 'empty', search: async () => [],
    }]
    const result = await searchPlugins({ entries: () => providers }, 'query', { providerTimeoutMs: 100 })
    expect(result.providerErrors).toEqual([{ provider: 'slow', error: 'provider timed out after 100ms' }])
    expect(result.candidates).toEqual([])
  })

  it('propagates caller cancellation through every provider signal', async () => {
    const controller = new AbortController()
    const providers: PluginSearchProvider[] = [{
      id: 'waiting',
      search: request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => {
        reject(request.signal.reason)
      }, { once: true })),
    }]
    const pending = searchPlugins({ entries: () => providers }, 'query', { signal: controller.signal })
    controller.abort(new Error('user cancelled search'))
    await expect(pending).rejects.toThrow('user cancelled search')
  })
})
