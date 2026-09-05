import { describe, expect, it } from 'vitest'
import { searchPlugins } from '../../src/search.ts'
import type { PluginSearchProvider } from '../../src/search-runtime.ts'
import { parsePluginSource, type PluginInspection, type PluginSource } from '../../src/source.ts'

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
      rank: 1,
      identity: 'github.com/example/shared',
      recommendedSource: 'shared-plugin@1.0.0',
    })
    expect(result.candidates[0]?.sources).toHaveLength(2)
    expect(result.presentation).toEqual({
      order: 'rank_ascending',
      returnedCandidates: 1,
      requestedMaximum: 20,
      includeEveryPossiblyRelevant: true,
      excludeClearlyIrrelevant: true,
      silentTopNTruncation: false,
    })
  })

  it('PM-026 returns the complete ranked result page instead of an implicit top five', async () => {
    const receivedLimits: number[] = []
    const provider: PluginSearchProvider = {
      id: 'catalog',
      search: async (request) => {
        receivedLimits.push(request.maxResults)
        return Array.from({ length: 8 }, (_, index) => ({
          id: `candidate-${String(index + 1)}`,
          title: `candidate-${String(index + 1)}`,
          score: 8 - index,
          sources: [{ kind: 'npm' as const, package: `candidate-${String(index + 1)}` }],
        }))
      },
    }
    const inspect = async (raw: string | PluginSource): Promise<PluginInspection> => {
      const source = typeof raw === 'string' ? parsePluginSource(raw) : raw
      if (source.kind !== 'npm') throw new Error('fixture expects npm')
      return {
        source: { ...source, version: '1.0.0' },
        sourceType: 'npm',
        requestedSpec: source.package,
        installSpec: `${source.package}@1.0.0`,
        packageName: source.package,
        version: '1.0.0',
        integrity: 'sha512-YQ==',
        repository: `github.com/example/${source.package}`,
        description: source.package,
        bundlePatch: './cordis.patch.yml',
        client: false,
        peerDependencies: {},
      }
    }

    const result = await searchPlugins({ entries: () => [provider] }, 'terminal', { inspect })

    expect(receivedLimits).toEqual([20])
    expect(result.candidates).toHaveLength(8)
    expect(result.candidates.map(candidate => candidate.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(result.candidates.at(-1)?.packageName).toBe('candidate-8')
    expect(result.presentation.silentTopNTruncation).toBe(false)
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

  it.each([
    ['owner:owner2021', false],
    ['github:owner2021', false],
    ['github.com/owner2021', false],
    ['https://github.com/owner2021', false],
    ['owner2021 DSH plugins', false],
    ['plugins by owner2021', false],
    ['DSH plugins from owner2021', false],
    ['owner2021', true],
  ])('A-028 parses %s into typed owner intent', async (query, fallbackToText) => {
    let received: Parameters<PluginSearchProvider['search']>[0] | undefined
    const provider: PluginSearchProvider = {
      id: 'capture',
      search: async (request) => {
        received = request
        return []
      },
    }

    const result = await searchPlugins({ entries: () => [provider] }, query)

    expect(result.query).toBe(query)
    expect(received).toMatchObject({
      query: 'owner2021',
      intent: { kind: 'github-owner', owner: 'owner2021', fallbackToText },
    })
  })

  it('A-028 leaves ordinary capability text as keyword search and rejects malformed owner syntax', async () => {
    let received: Parameters<PluginSearchProvider['search']>[0] | undefined
    const provider: PluginSearchProvider = {
      id: 'capture',
      search: async (request) => {
        received = request
        return []
      },
    }

    await searchPlugins({ entries: () => [provider] }, 'find plugins')
    expect(received).toMatchObject({ query: 'find plugins' })
    expect(received).not.toHaveProperty('intent')
    await expect(searchPlugins({ entries: () => [provider] }, 'owner:bad/name'))
      .rejects.toMatchObject({ code: 'INVALID_SEARCH_QUERY' })
  })

  it('A-028 verifies exact owner matches before cross-provider ranking and exposes provenance', async () => {
    const providers: PluginSearchProvider[] = [{
      id: 'github',
      search: async () => [{
        id: 'spoof',
        title: 'spoof',
        score: 999,
        sources: [{ kind: 'github', owner: 'attacker', repo: 'spoof' }],
        match: { kind: 'github-owner', value: 'yangbobo2021' },
      }, {
        id: 'owned',
        title: 'owned',
        score: 1,
        sources: [{ kind: 'github', owner: 'yangbobo2021', repo: 'relay-dsh-plugin-codex' }],
        match: { kind: 'github-owner', value: 'yangbobo2021' },
        evidence: ['Exact GitHub owner query: yangbobo2021'],
      }],
    }, {
      id: 'npm',
      search: async () => [{
        id: 'unrelated',
        title: 'unrelated',
        score: 9999,
        sources: [{ kind: 'npm', package: 'unrelated-market' }],
      }, {
        id: 'owned-alias',
        title: 'owned npm alias',
        score: 0,
        sources: [{ kind: 'npm', package: 'relay-dsh-plugin-codex' }],
      }],
    }]
    const inspect = async (raw: string | PluginSource): Promise<PluginInspection> => {
      const source = typeof raw === 'string' ? parsePluginSource(raw) : raw
      const github = source.kind === 'github'
      const packageName = github ? source.repo : source.package
      const owner = packageName === 'relay-dsh-plugin-codex' ? 'yangbobo2021' : github ? source.owner : 'market'
      const repo = packageName === 'relay-dsh-plugin-codex' ? packageName : github ? source.repo : 'general'
      if (source.kind === 'npm') {
        return {
          source: { ...source, version: '1.0.0' },
          sourceType: 'npm',
          requestedSpec: source.package,
          installSpec: `${source.package}@1.0.0`,
          packageName: source.package,
          version: '1.0.0',
          integrity: 'sha512-YQ==',
          repository: `github.com/${owner}/${repo}`,
          description: null,
          bundlePatch: './cordis.patch.yml',
          client: false,
          peerDependencies: {},
        }
      }
      return {
        source: { ...source, ref: 'a'.repeat(40) },
        sourceType: 'github',
        requestedSpec: `github:${source.owner}/${source.repo}`,
        installSpec: `github:${source.owner}/${source.repo}#${'a'.repeat(40)}`,
        packageName,
        commit: 'a'.repeat(40),
        repository: `github.com/${owner}/${repo}`,
        description: null,
        bundlePatch: './cordis.patch.yml',
        client: false,
        peerDependencies: {},
      }
    }

    const result = await searchPlugins({ entries: () => providers }, 'owner:yangbobo2021', { inspect })

    expect(result.candidates[0]).toMatchObject({
      packageName: 'relay-dsh-plugin-codex',
      repository: 'github.com/yangbobo2021/relay-dsh-plugin-codex',
      repositoryOwner: 'yangbobo2021',
      providers: ['github', 'npm'],
      matchReasons: ['Exact GitHub owner: yangbobo2021'],
      recommendedSource: 'relay-dsh-plugin-codex@1.0.0',
    })
    expect(result.candidates.find(candidate => candidate.packageName === 'spoof')?.matchReasons).toEqual([])
    expect(parsePluginSource(result.candidates[0]!.repository!)).toEqual({
      kind: 'github', owner: 'yangbobo2021', repo: 'relay-dsh-plugin-codex',
    })
    expect(parsePluginSource(result.candidates[0]!.recommendedSource)).toEqual({
      kind: 'npm', package: 'relay-dsh-plugin-codex', version: '1.0.0',
    })
  })
})
