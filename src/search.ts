import type {
  PluginSearchCandidate,
  PluginSearchProvider,
  PluginSearchRequest,
  PluginSearchRuntime,
} from './search-runtime.ts'
import {
  inspectionIdentity,
  inspectPluginSource,
  isGithubPart,
  parsePluginSource,
  type FetchOptions,
  type PluginInspection,
  type PluginSource,
} from './source.ts'
import { fail } from './errors.ts'

export interface SearchResultSource {
  inspection: PluginInspection
  providers: string[]
  evidence: string[]
}

export interface SearchResult {
  query: string
  candidates: Array<{
    rank: number
    identity: string
    packageName: string
    description: string | null
    repository: string | null
    repositoryOwner: string | null
    providers: string[]
    matchReasons: string[]
    semanticMatches: Array<{
      directoryVersion: string | null
      canonicalPathKey: string | null
      canonicalPath: string[]
      matchedCapabilities: string[]
      retrievalSources: string[]
    }>
    sources: SearchResultSource[]
    recommendedSource: string
  }>
  presentation: {
    order: 'rank_ascending'
    returnedCandidates: number
    requestedMaximum: number
    includeEveryDistinctRelevantSolution: true
    excludeClearlyIrrelevant: true
    deduplicateEquivalentSources: true
    padToRequestedMaximum: false
    silentTopNTruncation: false
  }
  providerErrors: Array<{ provider: string; error: string }>
  rejectedCandidates: number
}

export interface SearchOptions extends FetchOptions {
  maxResults?: number
  providerTimeoutMs?: number
  inspect?: typeof inspectPluginSource
}

function searchQuery(value: string): string {
  const query = value.trim()
  if (query === '' || query.length > 120 || /[\u0000-\u001f\u007f]/u.test(query)) {
    fail('INVALID_SEARCH_QUERY', 'Search query must contain 1 to 120 printable characters.')
  }
  return query
}

interface ParsedSearchQuery {
  query: string
  providerQuery: string
  intent?: PluginSearchRequest['intent']
}

function githubOwnerIntent(query: string): Omit<ParsedSearchQuery, 'query'> | null {
  const explicit = [
    /^owner:([^\s]+)$/iu,
    /^github:([^/\s]+)$/iu,
    /^(?:https:\/\/)?github\.com\/([^/\s]+)\/?$/iu,
    /^([^\s]+)\s+dsh\s+plugins?$/iu,
    /^(?:dsh\s+)?plugins?\s+(?:by|from)\s+([^\s]+)$/iu,
  ]
  for (const pattern of explicit) {
    const match = pattern.exec(query)
    if (match === null) continue
    const owner = match[1]!
    if (!isGithubPart(owner)) fail('INVALID_SEARCH_QUERY', 'GitHub owner query contains an invalid owner name.')
    return { providerQuery: owner, intent: { kind: 'github-owner', owner, fallbackToText: false } }
  }
  if (/^[A-Za-z0-9]+$/u.test(query) && /\d/u.test(query) && isGithubPart(query)) {
    return { providerQuery: query, intent: { kind: 'github-owner', owner: query, fallbackToText: true } }
  }
  return null
}

function parseSearchQuery(value: string): ParsedSearchQuery {
  const query = searchQuery(value)
  return { query, ...(githubOwnerIntent(query) ?? { providerQuery: query }) }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('search cancelled')
}

async function searchProvider(
  provider: PluginSearchProvider,
  query: string,
  intent: PluginSearchRequest['intent'],
  maxResults: number,
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Promise<readonly PluginSearchCandidate[]> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(parent?.reason)
  if (parent?.aborted === true) throw abortReason(parent)
  parent?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error(`provider timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    const result = await provider.search({
      query,
      maxResults,
      signal: controller.signal,
      ...(intent === undefined ? {} : { intent }),
    })
    if (!Array.isArray(result)) throw new TypeError('provider result must be an array')
    return result.slice(0, maxResults)
  } finally {
    clearTimeout(timeout)
    parent?.removeEventListener('abort', onAbort)
  }
}

interface DiscoveredSource {
  source: PluginSource
  provider: string
  evidence: string[]
  match: PluginSearchCandidate['match']
  rank: number
}

function candidateSources(provider: string, rows: readonly PluginSearchCandidate[]): DiscoveredSource[] {
  const output: DiscoveredSource[] = []
  const ranked = [...rows].sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id))
  for (const [rank, candidate] of ranked.entries()) {
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '' || !Array.isArray(candidate.sources)) continue
    for (const raw of candidate.sources.slice(0, 3)) {
      try {
        output.push({
          source: parsePluginSource(raw),
          provider,
          evidence: [...(candidate.evidence ?? [])].filter(value => typeof value === 'string').slice(0, 5),
          match: candidate.match,
          rank,
        })
      } catch {
        // Provider data is untrusted. Invalid sources are rejected during normalization.
      }
    }
  }
  return output
}

function candidateMatchReasons(match: PluginSearchCandidate['match']): string[] {
  if (match?.kind === 'github-owner') return []
  if (match?.kind === 'exact-identifier') return [`Exact identifier: ${match.value}`]
  if (match?.kind !== 'registry') return []
  return [
    ...(match.exactIdentifier ? ['Exact Registry identifier'] : []),
    ...(match.canonicalPath.length === 0 ? [] : [`Semantic directory: ${match.canonicalPath.join(' / ')}`]),
    ...(match.matchedCapabilities.length === 0 ? [] : [`Matched capabilities: ${match.matchedCapabilities.join(', ')}`]),
  ]
}

function matchPriority(match: PluginSearchCandidate['match'], exactOwner: boolean): number {
  if (exactOwner || match?.kind === 'exact-identifier' || (match?.kind === 'registry' && match.exactIdentifier)) return 0
  return 1
}

function semanticMatch(match: PluginSearchCandidate['match']): SearchResult['candidates'][number]['semanticMatches'][number] | null {
  if (match?.kind !== 'registry' || (match.canonicalPath.length === 0 && match.matchedCapabilities.length === 0)) return null
  return {
    directoryVersion: match.directoryVersion ?? null,
    canonicalPathKey: match.canonicalPathKey ?? null,
    canonicalPath: [...match.canonicalPath],
    matchedCapabilities: [...match.matchedCapabilities],
    retrievalSources: [...match.retrievalSources],
  }
}

export async function searchPlugins(
  runtime: Pick<PluginSearchRuntime, 'entries'>,
  rawQuery: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const parsed = parseSearchQuery(rawQuery)
  const maxResults = Math.max(1, Math.min(20, options.maxResults ?? 20))
  const timeoutMs = Math.max(100, options.providerTimeoutMs ?? 10_000)
  const providers = runtime.entries()
  const settled = await Promise.allSettled(providers.map(async provider => ({
    provider: provider.id,
    rows: await searchProvider(
      provider,
      parsed.providerQuery,
      parsed.intent,
      maxResults,
      options.signal,
      timeoutMs,
    ),
  })))
  if (options.signal?.aborted === true) throw abortReason(options.signal)

  const providerErrors: SearchResult['providerErrors'] = []
  const discovered: DiscoveredSource[] = []
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index]!
    const provider = providers[index]!.id
    if (result.status === 'rejected') {
      providerErrors.push({ provider, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
      continue
    }
    discovered.push(...candidateSources(result.value.provider, result.value.rows))
  }

  const inspect = options.inspect ?? inspectPluginSource
  const inspected = await Promise.all(discovered.map(async item => {
    try {
      const inspection = await inspect(item.source, options)
      return { ok: true as const, item, inspection }
    } catch {
      return { ok: false as const }
    }
  }))

  const accepted = inspected.flatMap(result => result.ok ? [result] : [])
  const parent = accepted.map((_, index) => index)
  const root = (index: number): number => {
    let current = index
    while (parent[current] !== current) current = parent[current]!
    while (parent[index] !== index) {
      const next = parent[index]!
      parent[index] = current
      index = next
    }
    return current
  }
  const join = (left: number, right: number): void => {
    const leftRoot = root(left)
    const rightRoot = root(right)
    if (leftRoot === rightRoot) return
    parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot)
  }
  const aliasOwner = new Map<string, number>()
  for (const [index, result] of accepted.entries()) {
    const aliases = [
      `package:${result.inspection.packageName.toLowerCase()}`,
      ...(result.inspection.repository === null ? [] : [`repository:${result.inspection.repository.toLowerCase()}`]),
    ]
    for (const alias of aliases) {
      const owner = aliasOwner.get(alias)
      if (owner === undefined) aliasOwner.set(alias, index)
      else join(index, owner)
    }
  }

  const projects = new Map<number, Omit<SearchResult['candidates'][number], 'rank'> & {
    rank: number
    matchPriority: number
  }>()
  const rejectedCandidates = inspected.length - accepted.length
  for (const [acceptedIndex, result] of accepted.entries()) {
    const project = root(acceptedIndex)
    const identity = inspectionIdentity(result.inspection)
    const repositoryOwner = /^github\.com\/([^/]+)\//iu
      .exec(result.inspection.repository ?? '')?.[1]?.toLowerCase() ?? null
    const exactOwnerValue = result.item.match?.kind === 'github-owner' ? result.item.match.value : null
    const exactOwner = exactOwnerValue !== null
      && repositoryOwner === exactOwnerValue.toLowerCase()
    const reasons = candidateMatchReasons(result.item.match)
    const semantic = semanticMatch(result.item.match)
    const existing = projects.get(project) ?? {
      identity,
      packageName: result.inspection.packageName,
      description: result.inspection.description,
      repository: result.inspection.repository,
      repositoryOwner,
      providers: [],
      matchReasons: [],
      semanticMatches: [],
      sources: [],
      recommendedSource: result.inspection.installSpec,
      rank: result.item.rank,
      matchPriority: matchPriority(result.item.match, exactOwner),
    }
    if (!existing.providers.includes(result.item.provider)) existing.providers.push(result.item.provider)
    if (exactOwner) {
      const reason = `Exact GitHub owner: ${exactOwnerValue}`
      if (!existing.matchReasons.includes(reason)) existing.matchReasons.push(reason)
    }
    for (const reason of reasons) if (!existing.matchReasons.includes(reason)) existing.matchReasons.push(reason)
    if (semantic !== null && !existing.semanticMatches.some(item => item.directoryVersion === semantic.directoryVersion
      && item.canonicalPathKey === semantic.canonicalPathKey)) existing.semanticMatches.push(semantic)
    const sameSource = existing.sources.find(source => source.inspection.installSpec === result.inspection.installSpec)
    if (sameSource === undefined) {
      existing.sources.push({
        inspection: result.inspection,
        providers: [result.item.provider],
        evidence: [...result.item.evidence],
      })
    } else {
      if (!sameSource.providers.includes(result.item.provider)) sameSource.providers.push(result.item.provider)
      for (const evidence of result.item.evidence) if (!sameSource.evidence.includes(evidence)) sameSource.evidence.push(evidence)
    }
    existing.rank = Math.min(existing.rank, result.item.rank)
    existing.matchPriority = Math.min(existing.matchPriority, matchPriority(result.item.match, exactOwner))
    const npm = existing.sources.find(source => source.inspection.sourceType === 'npm')
    existing.recommendedSource = npm?.inspection.installSpec ?? existing.sources[0]!.inspection.installSpec
    projects.set(project, existing)
  }

  const candidates = [...projects.values()]
    .sort((left, right) => left.matchPriority - right.matchPriority
      || left.rank - right.rank
      || left.packageName.localeCompare(right.packageName))
    .slice(0, maxResults)
    .map(({ rank: _providerRank, matchPriority: _matchPriority, ...candidate }, index) => ({
      ...candidate,
      rank: index + 1,
      providers: candidate.providers.sort(),
    }))
  return {
    query: parsed.query,
    candidates,
    presentation: {
      order: 'rank_ascending',
      returnedCandidates: candidates.length,
      requestedMaximum: maxResults,
      includeEveryDistinctRelevantSolution: true,
      excludeClearlyIrrelevant: true,
      deduplicateEquivalentSources: true,
      padToRequestedMaximum: false,
      silentTopNTruncation: false,
    },
    providerErrors,
    rejectedCandidates,
  }
}
