import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerConversationSurface } from '../../src/conversation.ts'
import * as PluginHost from '../../src/index.ts'
import type { PluginManager } from '../../src/manager.ts'
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
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(PluginSearchRuntime)

    expect(PluginHost.inject).toEqual(['pluginSearch', 'tools', 'commands', 'userQuestions', 'loader'])
    const host = await ctx.plugin(PluginHost)
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['plugin_discover', 'plugin_manage'])
    expect(ctx.commands.list({} as Agent).map(command => command.name)).toEqual(['plugins'])
    expect(ctx.pluginSearch.list()).toEqual(['github', 'npm'])

    await host.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.commands.list({} as Agent)).toEqual([])
    expect(ctx.pluginSearch.list()).toEqual([])
  })

  it('A-026 executes exact UI approval through real DSH registries and UserQuestionService', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    const manager = {
      discover: vi.fn(async () => ({ plugins: [] })),
      plan: vi.fn(async () => ({
        action: 'install',
        profile: 'web',
        packageName: 'fixture-plugin',
        installSpec: 'fixture-plugin@1.0.0',
        impact: 'Install fixture-plugin@1.0.0.',
        restartExpected: false,
        id: 'integration-plan',
        digest: 'integration-digest',
        confirmationToken: 'integration-token',
        createdAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:10:00.000Z',
      })),
      execute: vi.fn(() => ({ id: 'integration-operation', status: 'queued' })),
      operation: vi.fn(),
      cancel: vi.fn(),
    } as unknown as PluginManager
    registerConversationSurface(ctx, manager)

    const sessionId = 'integration-session' as Agent['id']
    const agent = {
      id: sessionId,
      session: {
        id: sessionId,
        header: { delegationDepth: 0 },
        events: [{ type: 'user/message', seq: 1 }],
      },
      ctx,
    } as unknown as Agent
    ctx.agents.register(agent)
    const signal = new AbortController().signal

    const planned = await ctx.tools.execute({
      signal,
      callId: CallId('plugin-plan-call'),
      name: 'plugin_manage',
      arguments: { action: 'plan', operation: 'install', source: 'fixture-plugin' },
      agent,
    })
    expect(planned.isError).toBe(false)
    expect(manager.execute).not.toHaveBeenCalled()

    const unavailable = await ctx.tools.execute({
      signal,
      callId: CallId('plugin-confirm-unavailable-call'),
      name: 'plugin_manage',
      arguments: { action: 'confirm', confirmationToken: 'integration-token' },
      agent,
    })
    expect(unavailable).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('no user-questions provider') }],
    })
    expect(manager.execute).not.toHaveBeenCalled()

    const seen: unknown[] = []
    ctx.userQuestions.registerProvider({
      async ask(request) {
        seen.push(request)
        return {
          answers: [{
            id: request.questions[0]!.id,
            selected: ['Approve plugin change'],
          }],
        }
      },
    })
    const confirmed = await ctx.tools.execute({
      signal,
      callId: CallId('plugin-confirm-call'),
      name: 'plugin_manage',
      arguments: { action: 'confirm', confirmationToken: 'integration-token' },
      agent,
    })

    expect(confirmed).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: expect.stringContaining('integration-operation') }],
    })
    const request = seen[0] as AskUserQuestionRequest
    expect(request.agent).toBe(agent)
    expect(request.questions).toMatchObject([{
        id: 'plugin-plan:integration-plan',
        detail: expect.stringContaining('Install fixture-plugin@1.0.0.'),
        intent: { kind: 'plan-review', approve: 'Approve plugin change' },
    }])
    expect(manager.execute).toHaveBeenCalledOnce()
    expect(manager.execute).toHaveBeenCalledWith('integration-token')
  })
})
