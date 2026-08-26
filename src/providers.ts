import type { PluginSearchProvider } from './search-runtime.ts'
import { NPM_NAME } from './source.ts'

const MAX_PROVIDER_RESULTS = 12

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
      const response = await fetchImpl(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(`${text} topic:dsh-plugin`)}&per_page=${Math.min(request.maxResults, MAX_PROVIDER_RESULTS)}`,
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
      if (!response.ok) throw new Error(`GitHub search returned HTTP ${response.status}`)
      const data = await response.json() as { items?: Array<{ id?: unknown; full_name?: unknown; description?: unknown; html_url?: unknown; stargazers_count?: unknown }> }
      return (data.items ?? []).flatMap((entry) => {
        if (typeof entry.full_name !== 'string') return []
        const [owner, repo, ...extra] = entry.full_name.split('/')
        if (owner === undefined || repo === undefined || extra.length > 0) return []
        return [{
          id: `github:${entry.id ?? entry.full_name}`,
          title: entry.full_name,
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          ...(typeof entry.html_url === 'string' ? { homepage: entry.html_url, repository: entry.html_url } : {}),
          sources: [{ kind: 'github' as const, owner, repo }],
          ...(typeof entry.stargazers_count === 'number' ? { score: entry.stargazers_count } : {}),
          evidence: [`GitHub stars: ${String(entry.stargazers_count ?? 0)}`],
        }]
      })
    },
  }
}
