import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-loader'
import { registerConversationSurface } from './conversation.ts'
import { HotRuntime } from './hot-runtime.ts'
import { PluginManager } from './manager.ts'
import { profileDirectory } from './profile.ts'
import { githubSearchProvider, npmSearchProvider } from './providers.ts'
import { DshRestarter } from './restart.ts'
import { DshCliRunner } from './runner.ts'

export const name = 'relay-dsh-plugin-manager'
export const inject = ['pluginSearch', 'tools', 'commands', 'loader']

export interface Config {
  allowRestart?: boolean
}

export function apply(ctx: Context, config: Config = {}): void {
  const profileDir = profileDirectory('web')
  ctx.pluginSearch.register(npmSearchProvider())
  ctx.pluginSearch.register(githubSearchProvider())

  const manager = new PluginManager({
    profileDir,
    searchRuntime: ctx.pluginSearch,
    runner: new DshCliRunner(),
    hot: new HotRuntime(ctx, profileDir),
    restarter: new DshRestarter({ allowRestart: config.allowRestart }),
    loader: ctx.loader,
  })
  registerConversationSurface(ctx, manager)
}

export { PluginManager } from './manager.ts'
export type { DiscoverRequest, MutationResult, PlanRequest } from './manager.ts'
export type { PluginSearchCandidate, PluginSearchProvider, PluginSearchRequest } from './search-runtime.ts'
export type { PluginInspection, PluginSource } from './source.ts'
