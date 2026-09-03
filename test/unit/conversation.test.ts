import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { describe, expect, it, vi } from 'vitest'
import { registerConversationSurface } from '../../src/conversation.ts'
import type { PluginManager } from '../../src/manager.ts'
import { PlanStore, type ConfirmationPlan, type PlanInput } from '../../src/plans.ts'

const APPROVE = 'Approve plugin change'
const DECLINE = 'Decline'

function fixturePlan(overrides: Partial<ConfirmationPlan> = {}): ConfirmationPlan {
  return {
    action: 'install',
    profile: 'web',
    packageName: 'fixture-plugin',
    installSpec: 'fixture-plugin@1.0.0',
    impact: 'Install fixture-plugin@1.0.0.',
    restartExpected: false,
    id: 'plan-1',
    digest: 'digest-1',
    confirmationToken: 'confirm-token',
    createdAt: '2099-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:10:00.000Z',
    ...overrides,
  } as ConfirmationPlan
}

function approval(questionId = 'plugin-plan:plan-1'): AskUserQuestionAnswer {
  return { answers: [{ id: questionId, selected: [APPROVE] }] }
}

function surface(options: {
  plan?: ConfirmationPlan
  ask?: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>
  execute?: (token: string) => unknown
} = {}) {
  const tools: ToolDefinition[] = []
  const commands: CommandDefinition[] = []
  const ask = vi.fn(options.ask ?? (async request => approval(request.questions[0]!.id)))
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { tools.push(tool); return () => undefined } },
    commands: { register: (command: CommandDefinition) => { commands.push(command); return () => undefined } },
    userQuestions: { ask },
  } as unknown as Context
  const manager = {
    discover: vi.fn(async () => ({ plugins: [] })),
    plan: vi.fn(async () => options.plan ?? fixturePlan()),
    execute: vi.fn(options.execute ?? (() => ({ id: 'operation-1', status: 'queued' }))),
    operation: vi.fn(() => ({ id: 'operation-1', status: 'running' })),
    cancel: vi.fn(() => ({ id: 'operation-1', status: 'running', progress: 'cancelling' })),
  } as unknown as PluginManager
  registerConversationSurface(ctx, manager)
  return { tools, commands, manager, ask }
}

function execution(sessionId = 'session-1', api: 'events' | 'snapshotEvents' = 'events') {
  const events: Array<{ type: string; seq: number }> = [{ type: 'user/message', seq: 1 }]
  const session = api === 'snapshotEvents'
    ? { id: sessionId, snapshotEvents: () => Object.freeze([...events]) }
    : { id: sessionId, events }
  return {
    events,
    value: {
      signal: new AbortController().signal,
      agent: { id: sessionId, session },
    } as unknown as ToolRunContext,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('conversation surface', () => {
  it('registers exactly one slash command and two compact tools', () => {
    const { tools, commands } = surface()
    expect(tools.map(tool => tool.name).sort()).toEqual(['plugin_discover', 'plugin_manage'])
    expect(commands.map(command => command.name)).toEqual(['plugins'])
    const discover = tools.find(tool => tool.name === 'plugin_discover')!
    expect(discover.description).toContain('owner:NAME')
    expect(discover.description).toContain('passed directly to inspect and plan')
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    expect(manage.description).toContain('plugin-owned DSH approval UI')
    expect(manage.description).toContain('NEVER wrap a plugin plan in generic ask_user_question')
    expect(manage.parameters).toMatchObject({
      properties: { action: { enum: ['plan', 'confirm', 'execute', 'status', 'cancel'] } },
    })
  })

  it('A-008 routes a plan separately and keeps generic tool results from authorizing execute', async () => {
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
    run.events.push({ type: 'tool/result', seq: 2 })
    await expect(manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, run.value))
      .rejects.toThrow(/later explicit user confirmation/i)
    expect(manager.execute).not.toHaveBeenCalled()

    const other = execution('session-2')
    other.events.push({ type: 'user/message', seq: 2 })
    await expect(manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, other.value))
      .rejects.toThrow(/not bound to this DSH conversation/i)
    run.events.push({ type: 'user/message', seq: 3 })
    await manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, run.value)
    expect(manager.execute).toHaveBeenCalledWith('confirm-token')
  })

  it('binds confirmation cursors through the rc.1 snapshotEvents API', async () => {
    const { tools, manager } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution('session-rc1', 'snapshotEvents')

    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)
    run.events.push({ type: 'user/message', seq: 2 })
    await manage.execute({ action: 'execute', confirmationToken: 'confirm-token' }, run.value)

    expect(manager.execute).toHaveBeenCalledWith('confirm-token')
  })

  it('A-026 waits for the controlled UI and executes only after exact approval', async () => {
    const answer = deferred<AskUserQuestionAnswer>()
    const { tools, manager, ask } = surface({ ask: () => answer.promise })
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()
    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)

    const confirming = manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value)
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce())
    expect(manager.execute).not.toHaveBeenCalled()

    const request = ask.mock.calls[0]![0]
    expect(request).toMatchObject({
      agent: run.value.agent,
      signal: run.value.signal,
      questions: [{
        id: 'plugin-plan:plan-1',
        question: 'Apply this plugin change?',
        header: 'Plugin plan',
        multiSelect: false,
        options: [{ label: APPROVE }, { label: DECLINE }],
        intent: { kind: 'plan-review', approve: APPROVE },
      }],
    })
    expect(request.questions[0]!.detail).toContain('Source: fixture-plugin@1.0.0')
    expect(request.questions[0]!.detail).not.toContain('confirm-token')
    expect(request.questions[0]!.detail).not.toContain('digest-1')

    answer.resolve(approval())
    await expect(confirming).resolves.toMatchObject({ id: 'operation-1', status: 'queued' })
    expect(manager.execute).toHaveBeenCalledOnce()
    expect(manager.execute).toHaveBeenCalledWith('confirm-token')
  })

  it('A-027 keeps a declined plan retriable, then executes one exact approval', async () => {
    const { tools, manager, ask } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()
    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)
    ask.mockResolvedValueOnce({ answers: [{ id: 'plugin-plan:plan-1', selected: [DECLINE] }] })

    await expect(manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value))
      .resolves.toEqual({ status: 'declined', planId: 'plan-1' })
    expect(manager.execute).not.toHaveBeenCalled()

    await manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value)
    expect(manager.execute).toHaveBeenCalledOnce()
  })

  it.each([
    ['wrong id', { answers: [{ id: 'other-plan', selected: [APPROVE] }] }],
    ['unknown choice', { answers: [{ id: 'plugin-plan:plan-1', selected: ['Maybe'] }] }],
    ['multiple choices', { answers: [{ id: 'plugin-plan:plan-1', selected: [APPROVE, DECLINE] }] }],
    ['custom answer', { answers: [{ id: 'plugin-plan:plan-1', selected: [], custom: 'approve' }] }],
    ['missing answer', { answers: [] }],
  ] satisfies Array<[string, AskUserQuestionAnswer]>)(
    'A-027 rejects %s without consuming the plan',
    async (_name, malformed) => {
      const { tools, manager, ask } = surface()
      const manage = tools.find(tool => tool.name === 'plugin_manage')!
      const run = execution()
      await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)
      ask.mockResolvedValueOnce(malformed)

      await expect(manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value))
        .rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' })
      expect(manager.execute).not.toHaveBeenCalled()

      await manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value)
      expect(manager.execute).toHaveBeenCalledOnce()
    },
  )

  it.each(['provider failed', 'question cancelled'])('A-027 keeps the plan after %s', async (message) => {
    const { tools, manager, ask } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()
    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)
    ask.mockRejectedValueOnce(new Error(message))

    await expect(manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value))
      .rejects.toThrow(message)
    expect(manager.execute).not.toHaveBeenCalled()

    await manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value)
    expect(manager.execute).toHaveBeenCalledOnce()
  })

  it('A-027 rejects cross-session and pre-prompt expiry before opening UI', async () => {
    const { tools, manager, ask } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const original = execution()
    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, original.value)

    await expect(manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, execution('other').value))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(ask).not.toHaveBeenCalled()
    await manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, original.value)
    expect(manager.execute).toHaveBeenCalledOnce()

    const expired = surface({ plan: fixturePlan({ expiresAt: '2000-01-01T00:00:00.000Z' }) })
    const expiredManage = expired.tools.find(tool => tool.name === 'plugin_manage')!
    const expiredRun = execution()
    await expiredManage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, expiredRun.value)
    await expect(expiredManage.execute({
      action: 'confirm', confirmationToken: 'confirm-token',
    }, expiredRun.value)).rejects.toMatchObject({ code: 'CONFIRMATION_EXPIRED' })
    expect(expired.ask).not.toHaveBeenCalled()
    expect(expired.manager.execute).not.toHaveBeenCalled()
  })

  it('A-027 lets PlanStore block a plan that expires while UI is open', async () => {
    const base = Date.now()
    let storeNow = base
    const ids = ['plan-expiring', 'token-expiring']
    const store = new PlanStore({ now: () => storeNow, random: () => ids.shift()!, ttlMs: 60_000 })
    const input: PlanInput = {
      action: 'install',
      profile: 'web',
      packageName: 'fixture-plugin',
      installSpec: 'fixture-plugin@1.0.0',
      impact: 'Install fixture.',
      restartExpected: false,
    }
    const plan = store.create(input)
    const answer = deferred<AskUserQuestionAnswer>()
    const { tools, manager, ask } = surface({
      plan,
      ask: () => answer.promise,
      execute: token => {
        store.consume(token)
        return { id: 'operation-expired', status: 'queued' }
      },
    })
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()
    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)
    const confirming = manage.execute({ action: 'confirm', confirmationToken: plan.confirmationToken }, run.value)
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce())

    storeNow = base + 60_000
    answer.resolve(approval('plugin-plan:plan-expiring'))
    await expect(confirming).rejects.toMatchObject({ code: 'CONFIRMATION_EXPIRED' })
    expect(manager.execute).toHaveBeenCalledOnce()
  })

  it('A-027 rejects replay after a successful UI approval', async () => {
    const { tools, manager, ask } = surface()
    const manage = tools.find(tool => tool.name === 'plugin_manage')!
    const run = execution()
    await manage.execute({ action: 'plan', operation: 'install', source: 'fixture-plugin' }, run.value)
    await manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value)

    await expect(manage.execute({ action: 'confirm', confirmationToken: 'confirm-token' }, run.value))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(ask).toHaveBeenCalledOnce()
    expect(manager.execute).toHaveBeenCalledOnce()
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
