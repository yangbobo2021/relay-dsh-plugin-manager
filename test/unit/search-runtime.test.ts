import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PluginSearchRuntime from '../../src/search-runtime.ts'

describe('PM-004 search provider registry', () => {
  it('registers, lists, rejects duplicates, and disposes with provider ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginSearchRuntime)
    expect(ctx.pluginSearch.apiVersion).toBe(1)
    const provider = {
      id: 'catalog',
      search: async () => [],
    }
    const dispose = ctx.pluginSearch.register(provider)
    expect(ctx.pluginSearch.list()).toEqual(['catalog'])
    expect(ctx.pluginSearch.entries()).toEqual([provider])
    expect(() => ctx.pluginSearch.register(provider)).toThrow(/already registered/)
    dispose()
    await viWaitFor(() => expect(ctx.pluginSearch.list()).toEqual([]))
    await ctx.fiber.dispose()
  })

  it('rejects invalid provider contracts', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginSearchRuntime)
    expect(() => ctx.pluginSearch.register({ id: 'Bad Provider', search: async () => [] }))
      .toThrow(/lowercase stable id/)
    await ctx.fiber.dispose()
  })
})

async function viWaitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  assertion()
}
