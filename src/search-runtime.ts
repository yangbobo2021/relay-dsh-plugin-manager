import { Context, Service } from '@deepseek-ai/cordis'
import { fail } from './errors.ts'
import type { PluginSource } from './source.ts'

export interface PluginSearchRequest {
  query: string
  maxResults: number
  signal: AbortSignal
  intent?: {
    kind: 'github-owner'
    owner: string
    fallbackToText: boolean
  }
}

export interface PluginSearchMatch {
  kind: 'github-owner'
  value: string
}

export interface PluginSearchCandidate {
  id: string
  title: string
  description?: string
  homepage?: string
  repository?: string
  sources: PluginSource[]
  score?: number
  evidence?: string[]
  match?: PluginSearchMatch
}

export interface PluginSearchProvider {
  id: string
  search(request: PluginSearchRequest): Promise<readonly PluginSearchCandidate[]>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginSearch: PluginSearchRuntime
  }
}

const PROVIDER_ID = /^[a-z][a-z0-9._-]{0,63}$/u

export class PluginSearchRuntime extends Service {
  readonly apiVersion = 1 as const
  private readonly providers = new Map<string, PluginSearchProvider>()

  constructor(ctx: Context) {
    super(ctx, 'pluginSearch')
  }

  register(provider: PluginSearchProvider): () => void {
    if (!PROVIDER_ID.test(provider.id) || typeof provider.search !== 'function') {
      throw new TypeError('plugin search provider requires a lowercase stable id and search function')
    }
    if (this.providers.has(provider.id)) {
      fail('DUPLICATE_SEARCH_PROVIDER', `A plugin search provider named "${provider.id}" is already registered.`)
    }
    const dispose = this.ctx.effect(function* (this: PluginSearchRuntime) {
      this.providers.set(provider.id, provider)
      yield () => this.providers.delete(provider.id)
    }.bind(this), 'pluginSearch.register()')
    return () => void dispose()
  }

  list(): readonly string[] {
    return Object.freeze([...this.providers.keys()].sort())
  }

  entries(): readonly PluginSearchProvider[] {
    return Object.freeze([...this.providers.values()])
  }
}

export default PluginSearchRuntime
