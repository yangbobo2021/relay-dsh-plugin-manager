import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerConversationSurface } from '../../src/conversation.ts'
import type { PluginManager } from '../../src/manager.ts'

function surface() {
  const tools: ToolDefinition[] = []
  const commands: CommandDefinition[] = []
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { tools.push(tool); return () => undefined } },
    commands: { register: (command: CommandDefinition) => { commands.push(command); return () => undefined } },
  } as unknown as Context
  const manager = {
    discover: vi.fn(async () => ({ plugins: [] })),
    plan: vi.fn(async () => ({ confirmationToken: 'confirm-token', impact: 'Install fixture.' })),
    execute: vi.fn(() => ({ id: 'operation-1', status: 'queued' })),
    operation: vi.fn(() => ({ id: 'operation-1', status: 'running' })),
    cancel: vi.fn(() => ({ id: 'operation-1', status: 'running', progress: 'cancelling' })),
  } as unknown as PluginManager
  registerConversationSurface(ctx, manager)
  return { tools, commands, manager }
}

function execution(sessionId = 'session-1') {
  const events: Array<{ type: 'user/message'; seq: number }> = [{ type: 'user/message', seq: 1 }]
  return {
    events,
    value: {
      signal: new AbortController().signal,
      agent: { session: { id: sessionId, events } },
    } as unknown as ToolRunContext,
  }
}

describe('conversation surface', () => {
  it('registers exactly one slash command and two compact tools', () => {
    const { tools, commands } = surface()
    expect(tools.map(tool => tool.name).sort()).toEqual(['plugin_discover', 'plugin_manage'])
    expect(commands.map(command => command.name)).toEqual(['plugins'])
    expect(tools.find(tool => tool.name === 'plugin_manage')?.description).toContain('later, explicit user confirmation')
  })

  it('routes a plan separately from token-gated execution', async () => {
    const { tools, manager } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()

    const planned = await manage.execute({
      action: 'plan', operation: 'install', source: 'fixture-plugin',
    }, run.value)
    expect(planned).toMatchObject({ confirmationToken: 'confirm-token' })
    expect(manager.plan).toHaveBeenCalledWith({ operation: 'install', source: 'fixture-plugin' }, run.value.signal)
    expect(manager.execute).not.toHaveBeenCalled()

    await expect(manage.execute({ action: 'execute' }, run.value)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    })
    await expect(manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, run.value))
      .rejects.toThrow(/later explicit user confirmation/i)
    const other = execution('session-2')
    other.events.push({ type: 'user/message', seq: 2 })
    await expect(manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, other.value))
      .rejects.toThrow(/not bound to this DSH conversation/i)
    run.events.push({ type: 'user/message', seq: 2 })
    await manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, run.value)
    expect(manager.execute).toHaveBeenCalledWith('confirm-token')
  })

  it('A-024 routes an ordered multi-install source list into one plan', async () => {
    const { tools, manager } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()
    const sources = ['plugin-a', 'github:example/plugin-b']

    await manage.execute({ action: 'plan', operation: 'install_many', sources }, run.value)

    expect(manager.plan).toHaveBeenCalledWith({ operation: 'install_many', sources }, run.value.signal)
    expect(manager.execute).not.toHaveBeenCalled()
  })

  it('steers the exact slash-command request into the receiving conversation', async () => {
    const { commands } = surface()
    const steer = vi.fn()
    const result = await commands[0]!.handler({
      commandId: 'command-1' as never,
      agent: { steer } as unknown as Agent,
      rawInput: '  安装 example-dsh-plugin  ',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ kind: 'success', text: 'Plugin request submitted to this conversation.' })
    expect(steer).toHaveBeenCalledOnce()
    expect(steer.mock.calls[0]![0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '安装 example-dsh-plugin' }],
      source: { kind: 'user' },
    })
  })

  it('turns an argument-free command into the default list request', async () => {
    const { commands } = surface()
    const steer = vi.fn()
    await commands[0]!.handler({
      commandId: 'command-2' as never,
      agent: { steer } as unknown as Agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(steer.mock.calls[0]![0]).toMatchObject({
      content: [{ type: 'text', text: 'List the installed DSH plugins and summarize their status.' }],
    })
  })
})
