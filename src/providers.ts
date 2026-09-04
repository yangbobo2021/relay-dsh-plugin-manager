import type { PluginSearchProvider } from './search-runtime.ts'
import { isGithubPart, NPM_NAME } from './source.ts'

const MAX_PROVIDER_RESULTS = 12
const REGISTRY_SNAPSHOT_ID = /^discovery\.[a-z0-9.-]+$/u

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

function registryEndpoint(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Registry URL must be an absolute URL.') }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Registry URL must use HTTPS, except for an explicit local development endpoint.')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Registry URL cannot contain credentials, query parameters, or a fragment.')
  }
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/v1/plugins:search`
  return url.href
}

function boundedText(value: unknown, maximum = 4_000): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= maximum ? value : undefined
}

function queryLocale(value: string): 'zh-CN' | 'en' {
  return /\p{Script=Han}/u.test(value) ? 'zh-CN' : 'en'
}

function registryCandidate(value: unknown, snapshotId: string): Awaited<ReturnType<PluginSearchProvider['search']>>[number] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const candidate = value as {
    entry?: {
      entry_id?: unknown
      identity?: { name?: unknown; repository_url?: unknown; repository_full_name?: unknown }
      imported_content?: { description?: { 'zh-CN'?: unknown; en?: unknown }; trust?: unknown }
      sources?: unknown
      resolution?: { status?: unknown }
    }
    match?: { score?: unknown; reason_codes?: unknown }
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
  const reasonCodes = Array.isArray(candidate.match?.reason_codes)
    ? candidate.match.reason_codes.filter((item): item is string => typeof item === 'string' && /^[a-z0-9_]+$/u.test(item)).slice(0, 8)
    : []
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
      `DSH Registry source snapshot: ${snapshotId}`,
      'Registry discovery record only; compatibility and security not tested',
      ...reasonCodes.map(code => `Registry match: ${code}`),
    ],
  }
}

export function registrySearchProvider(
  baseUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): PluginSearchProvider {
  const endpoint = registryEndpoint(baseUrl)
  return {
    id: 'dsh-registry',
    async search(request) {
      const text = query(request.query)
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: request.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          schema_version: '1.0.0', query: text, locale: queryLocale(text),
          limit: Math.min(request.maxResults, MAX_PROVIDER_RESULTS),
        }),
      })
      if (!response.ok) throw new Error(`DSH Registry search returned HTTP ${response.status}`)
      const data = await response.json() as { snapshot_id?: unknown; candidates?: unknown }
      if (typeof data.snapshot_id !== 'string' || !REGISTRY_SNAPSHOT_ID.test(data.snapshot_id) || !Array.isArray(data.candidates)) {
        throw new Error('DSH Registry search returned an invalid discovery response.')
      }
      return data.candidates.flatMap(candidate => {
        const normalized = registryCandidate(candidate, data.snapshot_id as string)
        return normalized === null ? [] : [normalized]
      }).slice(0, Math.min(request.maxResults, MAX_PROVIDER_RESULTS))
    },
  }
}
