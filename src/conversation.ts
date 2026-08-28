import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { PluginManager } from './manager.ts'
import type { PlanAction } from './plans.ts'
import { fail } from './errors.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function renderJson(_args: unknown, value: JsonValue): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

interface ConfirmationCursor {
  sessionId: string
  userMessageSeq: number
  expiresAt: number
}

function confirmationCursor(execution: ToolRunContext): Omit<ConfirmationCursor, 'expiresAt'> | null {
  const session = execution.agent?.session
  if (session === undefined) return null
  let userMessageSeq = -1
  for (const event of session.events) if (event.type === 'user/message') userMessageSeq = event.seq
  return { sessionId: String(session.id), userMessageSeq }
}

export function registerConversationSurface(ctx: Context, manager: PluginManager): void {
  const confirmations = new Map<string, ConfirmationCursor>()
  ctx.tools.register(defineTool({
    name: 'plugin_discover',
    description: 'Read-only DSH plugin discovery. List installed plugins, search registered sources, inspect one npm/GitHub source, or query plugin/operation status. This tool never changes the profile.',
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'inspect', 'status'],
        required: true,
        description: 'The read-only operation.',
      },
      query: { type: 'string', description: 'Natural-language search query.' },
      target: { type: 'string', description: 'npm package, GitHub source, or installed package name.' },
      operationId: { type: 'string', description: 'Operation id returned by plugin_manage.' },
      maxResults: { type: 'integer', description: 'Maximum merged search results.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    timeoutMs: 35_000,
    isConcurrencySafe: () => true,
    execute: async (args, execution) => jsonValue(await manager.discover(args, execution.signal)),
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_manage',
    description: 'Plan and run DSH plugin mutations. ALWAYS call action=plan first and show its impact. NEVER treat the request that produced a plan as confirmation. Only call action=execute with its confirmationToken after a later, explicit user confirmation. Use install_many with sources for one multi-plugin plan and confirmation. Install sources are npm or GitHub; search providers do not define installers.',
    parameters: {
      action: {
        type: 'string',
        enum: ['plan', 'execute', 'status', 'cancel'],
        required: true,
        description: 'Lifecycle stage. Mutations require plan followed by execute.',
      },
      operation: {
        type: 'string',
        enum: ['install', 'install_many', 'remove', 'update', 'enable', 'disable', 'restart'],
        description: 'Mutation to plan.',
      },
      target: { type: 'string', description: 'Installed package name, or install source when source is omitted.' },
      source: { type: 'string', description: 'npm package/version or canonical GitHub repository/ref.' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered npm/GitHub sources for operation=install_many (1-20 items).',
      },
      confirmationToken: { type: 'string', description: 'One-use token from a prior plan.' },
      operationId: { type: 'string', description: 'Tracked operation id.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    execute: async (args, execution) => {
      if (args.action === 'plan') {
        if (args.operation === undefined) fail('INVALID_ACTION', 'Planning requires an operation.')
        const plan = await manager.plan({
          operation: args.operation as PlanAction,
          ...(args.target === undefined ? {} : { target: args.target }),
          ...(args.source === undefined ? {} : { source: args.source }),
          ...(args.sources === undefined ? {} : { sources: args.sources }),
        }, execution.signal)
        const cursor = confirmationCursor(execution)
        if (cursor === null) fail('CONFIRMATION_REQUIRED', 'Planning requires a DSH Agent session.')
        const now = Date.now()
        for (const [token, binding] of confirmations) if (binding.expiresAt <= now) confirmations.delete(token)
        confirmations.set(plan.confirmationToken, { ...cursor, expiresAt: Date.parse(plan.expiresAt) })
        return jsonValue(plan)
      }
      if (args.action === 'execute') {
        if (args.confirmationToken === undefined) fail('CONFIRMATION_REQUIRED', 'Execution requires a confirmation token.')
        const binding = confirmations.get(args.confirmationToken)
        const cursor = confirmationCursor(execution)
        if (binding === undefined || cursor === null || cursor.sessionId !== binding.sessionId) {
          fail('CONFIRMATION_REQUIRED', 'Confirmation token is not bound to this DSH conversation.')
        }
        if (cursor.userMessageSeq <= binding.userMessageSeq) {
          fail('CONFIRMATION_REQUIRED', 'Wait for a later explicit user confirmation before execution.')
        }
        confirmations.delete(args.confirmationToken)
        return jsonValue(manager.execute(args.confirmationToken))
      }
      if (args.operationId === undefined) fail('OPERATION_NOT_FOUND', `${args.action} requires an operation id.`)
      return jsonValue(args.action === 'cancel'
        ? manager.cancel(args.operationId)
        : manager.operation(args.operationId))
    },
  }))

  ctx.commands.register({
    name: 'plugins',
    description: 'manage DSH plugins through this conversation',
    input: { hint: '<request>' },
    handler: ({ agent, rawInput }: CommandInvocation) => {
      const request = rawInput.trim() === ''
        ? 'List the installed DSH plugins and summarize their status.'
        : rawInput.trim()
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: request }],
        source: { kind: 'user' },
      }))
      return { kind: 'success', text: 'Plugin request submitted to this conversation.' }
    },
  })
}
