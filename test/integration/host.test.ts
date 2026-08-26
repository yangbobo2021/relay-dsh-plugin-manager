import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as PluginHost from '../../src/index.ts'
import PluginSearchRuntime from '../../src/search-runtime.ts'

const cleanup: string[] = []
const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('DSH host composition', () => {
  it('mounts and disposes the exact command, tool, and provider surface', async () => {
    const home = await mkdtemp(join(tmpdir(), 'relay-plugin-host-'))
    cleanup.push(home)
    process.env.DSH_HOME = home
    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(PluginSearchRuntime)

    const host = await ctx.plugin(PluginHost)
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['plugin_discover', 'plugin_manage'])
    expect(ctx.commands.list({} as Agent).map(command => command.name)).toEqual(['plugins'])
    expect(ctx.pluginSearch.list()).toEqual(['github', 'npm'])

    await host.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.commands.list({} as Agent)).toEqual([])
    expect(ctx.pluginSearch.list()).toEqual([])
  })
})
