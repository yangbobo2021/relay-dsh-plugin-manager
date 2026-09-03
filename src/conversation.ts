import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-user-questions'
import type { PluginManager } from './manager.ts'
import type { ConfirmationPlan, PlanAction } from './plans.ts'
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
  plan: ConfirmationPlan
}

const APPROVE_LABEL = 'Approve plugin change'
const DECLINE_LABEL = 'Decline'

function sessionEvents(session: object): ReadonlyArray<{ type: string; seq: number }> {
  const snapshot = Reflect.get(session, 'snapshotEvents') as unknown
  if (typeof snapshot === 'function') {
    return Reflect.apply(snapshot, session, []) as ReadonlyArray<{ type: string; seq: number }>
  }
  const events = Reflect.get(session, 'events') as unknown
  if (!Array.isArray(events)) throw new TypeError('DSH Session exposes neither snapshotEvents() nor events')
  return events as ReadonlyArray<{ type: string; seq: number }>
}

function confirmationCursor(
  execution: ToolRunContext,
): Pick<ConfirmationCursor, 'sessionId' | 'userMessageSeq'> | null {
  const session = execution.agent?.session
  if (session === undefined) return null
  let userMessageSeq = -1
  for (const event of sessionEvents(session)) if (event.type === 'user/message') userMessageSeq = event.seq
  return { sessionId: String(session.id), userMessageSeq }
}

function planDetail(plan: ConfirmationPlan): string {
  const lines = [
    `Operation: ${plan.action}`,
    `Profile: ${plan.profile}`,
    `Impact: ${plan.impact}`,
    `Restart expected: ${plan.restartExpected ? 'yes' : 'no'}`,
  ]
  if (plan.action === 'install_many') {
    lines.push('Plugins:')
    for (const item of plan.items) lines.push(`- ${item.packageName}: ${item.installSpec}`)
    if (plan.missingPeerDependencies.length > 0) {
      lines.push('Missing required peer dependencies:')
      for (const peer of plan.missingPeerDependencies) {
        lines.push(`- ${peer.packageName} (${peer.ranges.join(', ')}) required by ${peer.requiredBy.join(', ')}`)
      }
    }
  } else {
    if (plan.packageName !== undefined) lines.push(`Plugin: ${plan.packageName}`)
    if (plan.installSpec !== undefined) lines.push(`Source: ${plan.installSpec}`)
    if (plan.currentSource !== undefined) lines.push(`Current source: ${plan.currentSource}`)
  }
  return lines.join('\n')
}

function confirmationBinding(
  confirmations: Map<string, ConfirmationCursor>,
  token: string,
  execution: ToolRunContext,
  now: number,
): ConfirmationCursor {
  const binding = confirmations.get(token)
  const cursor = confirmationCursor(execution)
  if (binding === undefined || cursor === null || cursor.sessionId !== binding.sessionId) {
    fail('CONFIRMATION_REQUIRED', 'Confirmation token is not bound to this DSH conversation.')
  }
  if (binding.expiresAt <= now) {
    confirmations.delete(token)
    fail('CONFIRMATION_EXPIRED', 'Confirmation token has expired.')
  }
  return binding
}

export function registerConversationSurface(ctx: Context, manager: PluginManager): void {
  const confirmations = new Map<string, ConfirmationCursor>()
  ctx.tools.register(defineTool({
    name: 'plugin_discover',
    description: 'Read-only DSH plugin discovery. List installed plugins, search registered sources (including GitHub owner:NAME), inspect one npm/GitHub repository source, or query plugin/operation status. Search result repository and recommendedSource values can be passed directly to inspect and plan. This tool never changes the profile.',
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'inspect', 'status'],
        required: true,
        description: 'The read-only operation.',
      },
      query: { type: 'string', description: 'Natural-language query or GitHub owner:NAME search.' },
      target: { type: 'string', description: 'npm package, github:owner/repo, https://github.com/owner/repo, github.com/owner/repo, or installed package name.' },
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
    description: 'Plan and run DSH plugin mutations. ALWAYS call action=plan first and show its impact. NEVER treat the request that produced a plan as confirmation. Prefer action=confirm with its confirmationToken to show the plugin-owned DSH approval UI and execute an exact approval. Alternatively, call action=execute only after a later explicit user Chat message. NEVER wrap a plugin plan in generic ask_user_question. Use install_many with sources for one multi-plugin plan and confirmation. Install sources are npm or GitHub; search providers do not define installers.',
    parameters: {
      action: {
        type: 'string',
        enum: ['plan', 'confirm', 'execute', 'status', 'cancel'],
        required: true,
        description: 'Lifecycle stage. Mutations require plan followed by controlled confirm or later-message execute.',
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
        confirmations.set(plan.confirmationToken, {
          ...cursor,
          expiresAt: Date.parse(plan.expiresAt),
          plan,
        })
        return jsonValue(plan)
      }
      if (args.action === 'confirm') {
        if (args.confirmationToken === undefined) fail('CONFIRMATION_REQUIRED', 'Confirmation requires a token.')
        const binding = confirmationBinding(confirmations, args.confirmationToken, execution, Date.now())
        const questionId = `plugin-plan:${binding.plan.id}`
        const answer = await ctx.userQuestions.ask({
          questions: [{
            id: questionId,
            question: 'Apply this plugin change?',
            detail: planDetail(binding.plan),
            header: 'Plugin plan',
            options: [
              { label: APPROVE_LABEL, description: 'Apply the exact plan shown above.' },
              { label: DECLINE_LABEL, description: 'Keep the profile unchanged.' },
            ],
            multiSelect: false,
            intent: { kind: 'plan-review', approve: APPROVE_LABEL },
          }],
          ...(execution.agent === undefined ? {} : { agent: execution.agent }),
          signal: execution.signal,
        })
        const answered = answer.answers[0]
        const isExactAnswer = answer.answers.length === 1
          && answered?.id === questionId
          && answered.custom === undefined
          && answered.selected.length === 1
        if (!isExactAnswer) {
          fail('CONFIRMATION_INVALID', 'Plugin confirmation did not match the requested plan and was not executed.')
        }
        if (answered.selected[0] === DECLINE_LABEL) {
          return jsonValue({ status: 'declined', planId: binding.plan.id })
        }
        if (answered.selected[0] !== APPROVE_LABEL) {
          fail('CONFIRMATION_INVALID', 'Plugin confirmation used an unknown choice and was not executed.')
        }
        confirmations.delete(args.confirmationToken)
        return jsonValue(manager.execute(args.confirmationToken))
      }
      if (args.action === 'execute') {
        if (args.confirmationToken === undefined) fail('CONFIRMATION_REQUIRED', 'Execution requires a confirmation token.')
        const binding = confirmationBinding(confirmations, args.confirmationToken, execution, Date.now())
        const cursor = confirmationCursor(execution)
        if (cursor === null) fail('CONFIRMATION_REQUIRED', 'Execution requires a DSH Agent session.')
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
