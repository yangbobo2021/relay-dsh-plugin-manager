import type { PluginSearchProvider } from './search-runtime.ts'
import { isGithubPart, NPM_NAME } from './source.ts'

const MAX_PROVIDER_RESULTS = 20
const REGISTRY_KEYWORD_CHALLENGER_POOL = 21
const REGISTRY_DIRECTORY_POOL = 50
const RECIPROCAL_RANK_OFFSET = 20
const KEYWORD_RANK_WEIGHT = 0.1
const DIRECTORY_RANK_WEIGHT = 0.2
const IDENTITY_TERM_BOOST = 0.01
const REGISTRY_SNAPSHOT_ID = /^discovery\.[a-z0-9.-]+$/u
const REGISTRY_DIRECTORY_VERSION = /^[a-z0-9][a-z0-9._-]{0,127}$/u

function query(value: string): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('Search query must contain 1 to 120 printable characters.')
  }
  return normalized
}

export function npmSearchProvider(fetchImpl: typeof globalThis.fetch = globalThis.fetch): PluginSearchProvider {
  return {
    id: 'npm',
    async search(request) {
      const text = query(request.query)
      const response = await fetchImpl(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(`${text} keywords:dsh-plugin`)}&size=${Math.min(request.maxResults, MAX_PROVIDER_RESULTS)}`,
        { signal: request.signal, headers: { accept: 'application/json' } },
      )
      if (!response.ok) throw new Error(`npm search returned HTTP ${response.status}`)
      const data = await response.json() as { objects?: Array<{ package?: { name?: unknown; description?: unknown; links?: { homepage?: unknown; repository?: unknown } }; score?: { final?: unknown } }> }
      const searched = (data.objects ?? []).flatMap((entry) => {
        const name = entry.package?.name
        if (typeof name !== 'string' || !NPM_NAME.test(name)) return []
        return [{
          id: `npm:${name}`,
          title: name,
          ...(typeof entry.package?.description === 'string' ? { description: entry.package.description } : {}),
          ...(typeof entry.package?.links?.homepage === 'string' ? { homepage: entry.package.links.homepage } : {}),
          ...(typeof entry.package?.links?.repository === 'string' ? { repository: entry.package.links.repository } : {}),
          sources: [{ kind: 'npm' as const, package: name }],
          ...(typeof entry.score?.final === 'number' ? { score: entry.score.final } : {}),
        }]
      })
      if (!NPM_NAME.test(text) || searched.some(candidate => candidate.sources.some(source => source.kind === 'npm' && source.package === text))) {
        return searched
      }
      return [{
        id: `npm:${text}`,
        title: text,
        sources: [{ kind: 'npm' as const, package: text }],
        score: Number.MAX_SAFE_INTEGER,
        evidence: ['Exact npm package-name query'],
        match: { kind: 'exact-identifier' as const, value: text },
      }, ...searched]
    },
  }
}

export function githubSearchProvider(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  env: NodeJS.ProcessEnv = process.env,
): PluginSearchProvider {
  return {
    id: 'github',
    async search(request) {
      const text = query(request.query)
      const token = env.GITHUB_TOKEN ?? env.GH_TOKEN
      type Repository = {
        id?: unknown
        full_name?: unknown
        description?: unknown
        html_url?: unknown
        stargazers_count?: unknown
      }
      const search = async (searchText: string): Promise<{ response: Response; items: Repository[] }> => {
        const response = await fetchImpl(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(searchText)}&per_page=${Math.min(request.maxResults, MAX_PROVIDER_RESULTS)}`,
          {
            signal: request.signal,
            headers: {
              accept: 'application/vnd.github+json',
              'user-agent': 'relay-dsh-plugin-manager',
              'x-github-api-version': '2022-11-28',
              ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
            },
          },
        )
        if (!response.ok) return { response, items: [] }
        const data = await response.json() as { items?: Repository[] }
        return { response, items: data.items ?? [] }
      }

      const owner = request.intent?.kind === 'github-owner' ? request.intent.owner : undefined
      let exactOwner = owner !== undefined
      let result = await search(owner === undefined
        ? `${text} topic:dsh-plugin`
        : `user:${owner} topic:dsh-plugin`)
      let entries = result.items
      if (owner !== undefined) {
        entries = entries.filter(entry => typeof entry.full_name === 'string'
          && entry.full_name.split('/')[0]?.toLowerCase() === owner.toLowerCase())
        const shouldFallback = request.intent?.fallbackToText === true
          && (result.response.status === 422 || (result.response.ok && entries.length === 0))
        if (shouldFallback) {
          result = await search(`${text} topic:dsh-plugin`)
          entries = result.items
          exactOwner = false
        }
      }
      if (!result.response.ok) throw new Error(`GitHub search returned HTTP ${result.response.status}`)

      return entries.flatMap((entry) => {
        if (typeof entry.full_name !== 'string') return []
        const [repositoryOwner, repo, ...extra] = entry.full_name.split('/')
        if (repositoryOwner === undefined || repo === undefined || extra.length > 0) return []
        return [{
          id: `github:${entry.id ?? entry.full_name}`,
          title: entry.full_name,
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          ...(typeof entry.html_url === 'string' ? { homepage: entry.html_url, repository: entry.html_url } : {}),
          sources: [{ kind: 'github' as const, owner: repositoryOwner, repo }],
          ...(typeof entry.stargazers_count === 'number' ? { score: entry.stargazers_count } : {}),
          evidence: [
            `GitHub repository owner: ${repositoryOwner}`,
            ...(exactOwner ? [`Exact GitHub owner query: ${owner!}`] : []),
            `GitHub stars: ${String(entry.stargazers_count ?? 0)}`,
          ],
          ...(exactOwner ? { match: { kind: 'github-owner' as const, value: owner! } } : {}),
        }]
      })
    },
  }
}

function registryEndpoint(value: string, operation: 'search' | 'route'): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Registry URL must be an absolute URL.') }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Registry URL must use HTTPS, except for an explicit local development endpoint.')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Registry URL cannot contain credentials, query parameters, or a fragment.')
  }
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/v1/plugins:${operation}`
  return url.href
}

function boundedText(value: unknown, maximum = 4_000): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= maximum ? value : undefined
}

function queryLocale(value: string): 'zh-CN' | 'en' {
  return /\p{Script=Han}/u.test(value) ? 'zh-CN' : 'en'
}

interface RegistryResponseMetadata {
  snapshotId: string
  strategy: 'keyword' | 'keyword-plus-semantic-directory-v1'
  directoryVersion?: string
  locale: 'zh-CN' | 'en'
}

function safeCodes(value: unknown, maximum = 20): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && /^[a-z0-9._-]+$/u.test(item)).slice(0, maximum)
    : []
}

function safePath(value: unknown, locale: 'zh-CN' | 'en'): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
    const path = item as { en?: unknown; zh_CN?: unknown }
    const label = locale === 'en'
      ? boundedText(path.en, 200) ?? boundedText(path.zh_CN, 200)
      : boundedText(path.zh_CN, 200) ?? boundedText(path.en, 200)
    return label === undefined ? [] : [label]
  }).slice(0, 8)
}

function registryCandidate(value: unknown, metadata: RegistryResponseMetadata): Awaited<ReturnType<PluginSearchProvider['search']>>[number] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const candidate = value as {
    entry?: {
      entry_id?: unknown
      identity?: { name?: unknown; repository_url?: unknown; repository_full_name?: unknown }
      imported_content?: { description?: { 'zh-CN'?: unknown; en?: unknown }; trust?: unknown }
      sources?: unknown
      resolution?: { status?: unknown }
    }
    match?: {
      score?: unknown
      reason_codes?: unknown
      retrieval_sources?: unknown
      keyword_reason_codes?: unknown
      canonical_path_key?: unknown
      canonical_primary_path?: unknown
      matched_capabilities?: unknown
    }
  }
  const entry = candidate.entry
  if (typeof entry !== 'object' || entry === null
    || boundedText(entry.entry_id, 100) === undefined
    || boundedText(entry.identity?.name, 214) === undefined
    || entry.imported_content?.trust !== 'untrusted_text'
    || entry.resolution?.status !== 'source_only'
    || !Array.isArray(entry.sources)) return null
  const sources = entry.sources.flatMap((source): Array<{ kind: 'npm'; package: string } | { kind: 'github'; owner: string; repo: string; ref?: string }> => {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return []
    const item = source as { kind?: unknown; package_name?: unknown; repository?: unknown; spec?: unknown; exact?: unknown }
    if (item.exact !== false) return []
    if (item.kind === 'npm' && typeof item.package_name === 'string' && NPM_NAME.test(item.package_name)) {
      return [{ kind: 'npm', package: item.package_name }]
    }
    if (item.kind !== 'github' || typeof item.repository !== 'string' || typeof item.spec !== 'string') return []
    const [owner, repo, ...extra] = item.repository.split('/')
    if (owner === undefined || repo === undefined || extra.length > 0 || !isGithubPart(owner) || !isGithubPart(repo)) return []
    const prefix = `github:${item.repository}`
    if (!item.spec.startsWith(prefix)) return []
    const suffix = item.spec.slice(prefix.length)
    if (suffix !== '' && !suffix.startsWith('#')) return []
    return [{ kind: 'github', owner, repo, ...(suffix === '' ? {} : { ref: suffix.slice(1) }) }]
  })
  if (sources.length === 0) return null
  const zh = boundedText(entry.imported_content?.description?.['zh-CN'])
  const en = boundedText(entry.imported_content?.description?.en)
  const repository = boundedText(entry.identity?.repository_url, 500)
  const reasonCodes = safeCodes(candidate.match?.reason_codes ?? candidate.match?.keyword_reason_codes, 8)
  const retrievalSources = safeCodes(candidate.match?.retrieval_sources, 8)
  const canonicalPathKey = boundedText(candidate.match?.canonical_path_key, 500)
  const canonicalPath = safePath(candidate.match?.canonical_primary_path, metadata.locale)
  const matchedCapabilities = safeCodes(candidate.match?.matched_capabilities, 8)
  const exactIdentifier = reasonCodes.includes('exact_identifier')
  const score = typeof candidate.match?.score === 'number' && Number.isFinite(candidate.match.score) && candidate.match.score >= 0
    ? candidate.match.score
    : undefined
  return {
    id: `registry:${entry.entry_id}`,
    title: entry.identity!.name as string,
    ...(zh !== undefined || en !== undefined ? { description: zh ?? en } : {}),
    ...(repository === undefined ? {} : { homepage: repository, repository }),
    sources,
    ...(score === undefined ? {} : { score }),
    evidence: [
      `DSH Registry source snapshot: ${metadata.snapshotId}`,
      ...(metadata.directoryVersion === undefined ? [] : [`DSH Registry directory version: ${metadata.directoryVersion}`]),
      ...(canonicalPath.length === 0 ? [] : [`Semantic directory: ${canonicalPath.join(' / ')}`]),
      ...(matchedCapabilities.length === 0 ? [] : [`Matched capabilities: ${matchedCapabilities.join(', ')}`]),
      'Registry discovery record only; compatibility and security not tested',
      ...reasonCodes.map(code => `Registry match: ${code}`),
    ],
    match: {
      kind: 'registry',
      strategy: metadata.strategy,
      snapshotId: metadata.snapshotId,
      ...(metadata.directoryVersion === undefined ? {} : { directoryVersion: metadata.directoryVersion }),
      retrievalSources,
      keywordReasonCodes: reasonCodes,
      ...(canonicalPathKey === undefined ? {} : { canonicalPathKey }),
      canonicalPath,
      matchedCapabilities,
      exactIdentifier,
    },
  }
}

interface ParsedRegistryResponse {
  metadata: RegistryResponseMetadata
  candidates: Awaited<ReturnType<PluginSearchProvider['search']>>
}

async function parseRegistryResponse(
  response: Response,
  strategy: RegistryResponseMetadata['strategy'],
  locale: RegistryResponseMetadata['locale'],
): Promise<ParsedRegistryResponse> {
  if (!response.ok) throw new Error(`DSH Registry ${strategy === 'keyword' ? 'search' : 'directory route'} returned HTTP ${response.status}`)
  const data = await response.json() as {
    snapshot_id?: unknown
    directory_version?: unknown
    candidates?: unknown
    is_final_recommendation?: unknown
    grants_install_approval?: unknown
  }
  const directoryVersion = strategy === 'keyword-plus-semantic-directory-v1'
    && typeof data.directory_version === 'string'
    && REGISTRY_DIRECTORY_VERSION.test(data.directory_version)
    ? data.directory_version
    : undefined
  if (typeof data.snapshot_id !== 'string' || !REGISTRY_SNAPSHOT_ID.test(data.snapshot_id)
    || !Array.isArray(data.candidates)
    || data.is_final_recommendation === true
    || data.grants_install_approval === true
    || (strategy === 'keyword-plus-semantic-directory-v1' && directoryVersion === undefined)) {
    throw new Error('DSH Registry search returned an invalid discovery response.')
  }
  const metadata: RegistryResponseMetadata = {
    snapshotId: data.snapshot_id,
    strategy,
    locale,
    ...(directoryVersion === undefined ? {} : { directoryVersion }),
  }
  return {
    metadata,
    candidates: data.candidates.flatMap(candidate => {
      const normalized = registryCandidate(candidate, metadata)
      return normalized === null ? [] : [normalized]
    }),
  }
}

const IDENTITY_STOP_TERMS = new Set([
  'and', 'dsh', 'for', 'from', 'inside', 'into', 'plugin', 'plugins', 'the', 'use', 'using', 'with',
])

function identityTermCoverage(searchText: string, candidate: Awaited<ReturnType<PluginSearchProvider['search']>>[number]): number {
  const terms = [...new Set(searchText.toLowerCase().match(/[a-z0-9@]+/gu) ?? [])]
    .filter(term => term.length >= 3 && !IDENTITY_STOP_TERMS.has(term))
  if (terms.length === 0) return 0
  const identityTerms = new Set(`${candidate.title} ${candidate.repository ?? ''}`.toLowerCase().split(/[^a-z0-9@]+/gu).filter(Boolean))
  return terms.filter(term => identityTerms.has(term)).length / terms.length
}

function mergeRegistryRankings(
  searchText: string,
  keyword: ParsedRegistryResponse | null,
  directory: ParsedRegistryResponse | null,
  limit: number,
): Awaited<ReturnType<PluginSearchProvider['search']>> {
  type Ranked = { candidate: Awaited<ReturnType<PluginSearchProvider['search']>>[number]; score: number; keywordRank?: number; directoryRank?: number }
  const combined = new Map<string, Ranked>()
  for (const [source, response, weight] of [
    ['keyword', keyword, KEYWORD_RANK_WEIGHT],
    ['directory', directory, DIRECTORY_RANK_WEIGHT],
  ] as const) {
    if (response === null) continue
    response.candidates.forEach((candidate, index) => {
      // When keyword search is healthy, the directory may rerank its bounded
      // candidate pool but cannot flood the page with loosely related siblings.
      if (source === 'directory' && keyword !== null && !combined.has(candidate.id)) return
      const current = combined.get(candidate.id) ?? { candidate, score: 0 }
      current.score += weight / (RECIPROCAL_RANK_OFFSET + index + 1)
      if (source === 'keyword') current.keywordRank = index + 1
      else {
        current.directoryRank = index + 1
        current.candidate = candidate
      }
      combined.set(candidate.id, current)
    })
  }
  return [...combined.values()].map(item => {
    const keywordMatch = keyword?.candidates.find(candidate => candidate.id === item.candidate.id)?.match
    const directoryMatch = directory?.candidates.find(candidate => candidate.id === item.candidate.id)?.match
    const exactIdentifier = (keywordMatch?.kind === 'registry' && keywordMatch.exactIdentifier)
      || (directoryMatch?.kind === 'registry' && directoryMatch.exactIdentifier)
    const registryMatch = directoryMatch?.kind === 'registry'
      ? directoryMatch
      : keywordMatch?.kind === 'registry' ? keywordMatch : null
    const score = item.score
      + IDENTITY_TERM_BOOST * identityTermCoverage(searchText, item.candidate)
      + (exactIdentifier ? 1 : 0)
    return {
      ...item.candidate,
      score,
      ...(registryMatch === null ? {} : {
        match: {
          ...registryMatch,
          strategy: directory === null ? 'keyword' as const : 'keyword-plus-semantic-directory-v1' as const,
          keywordReasonCodes: keywordMatch?.kind === 'registry' ? keywordMatch.keywordReasonCodes : registryMatch.keywordReasonCodes,
          exactIdentifier,
        },
      }),
      evidence: [
        ...item.candidate.evidence ?? [],
        `Registry rank fusion: keyword=${String(item.keywordRank ?? 'none')}, directory=${String(item.directoryRank ?? 'none')}`,
      ],
    }
  }).sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id)).slice(0, limit)
}

export interface RegistrySearchProviderOptions {
  strategy?: 'keyword' | 'hybrid'
}

export function registrySearchProvider(
  baseUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  options: RegistrySearchProviderOptions = {},
): PluginSearchProvider {
  const keywordEndpoint = registryEndpoint(baseUrl, 'search')
  const directoryEndpoint = registryEndpoint(baseUrl, 'route')
  const strategy = options.strategy ?? 'hybrid'
  return {
    id: 'dsh-registry',
    async search(request) {
      const text = query(request.query)
      const locale = queryLocale(text)
      const outputLimit = Math.min(request.maxResults, MAX_PROVIDER_RESULTS)
      const requestEndpoint = async (endpoint: string, responseStrategy: RegistryResponseMetadata['strategy'], limit: number) => parseRegistryResponse(await fetchImpl(endpoint, {
        method: 'POST',
        signal: request.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ schema_version: '1.0.0', query: text, locale, limit }),
      }), responseStrategy, locale)
      if (strategy === 'keyword') {
        return (await requestEndpoint(keywordEndpoint, 'keyword', outputLimit)).candidates.slice(0, outputLimit)
      }
      const [keywordResult, directoryResult] = await Promise.allSettled([
        requestEndpoint(keywordEndpoint, 'keyword', REGISTRY_KEYWORD_CHALLENGER_POOL),
        requestEndpoint(directoryEndpoint, 'keyword-plus-semantic-directory-v1', REGISTRY_DIRECTORY_POOL),
      ])
      const keyword = keywordResult.status === 'fulfilled' ? keywordResult.value : null
      const directory = directoryResult.status === 'fulfilled' ? directoryResult.value : null
      if (keyword === null && directory === null) {
        const reasons = [keywordResult, directoryResult].map(result => result.status === 'rejected'
          ? result.reason instanceof Error ? result.reason.message : String(result.reason)
          : '').filter(Boolean)
        throw new Error(`DSH Registry search failed: ${reasons.join('; ')}`)
      }
      if (keyword !== null && directory !== null && keyword.metadata.snapshotId !== directory.metadata.snapshotId) {
        throw new Error('DSH Registry keyword and directory responses reference different snapshots.')
      }
      return mergeRegistryRankings(text, keyword, directory, outputLimit)
    },
  }
}
