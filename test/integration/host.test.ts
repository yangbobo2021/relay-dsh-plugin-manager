import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerConversationSurface } from '../../src/conversation.ts'
import * as PluginHost from '../../src/index.ts'
import { PluginManager } from '../../src/manager.ts'
import PluginSearchRuntime from '../../src/search-runtime.ts'
import type { SearchResult } from '../../src/search.ts'
import type { ConfirmationPlan } from '../../src/plans.ts'
import type { PluginInspection, PluginSource } from '../../src/source.ts'

const cleanup: string[] = []
const originalDshHome = process.env.DSH_HOME

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function toolJson(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? []
  const text = content.find(item => item.type === 'text')?.text
  if (text === undefined) throw new Error('tool result has no text content')
  return JSON.parse(text) as unknown
}

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
      callId: ToolCallId('plugin-plan-call'),
      name: 'plugin_manage',
      arguments: { action: 'plan', operation: 'install', source: 'fixture-plugin' },
      agent,
    })
    expect(planned.isError).toBe(false)
    expect(manager.execute).not.toHaveBeenCalled()

    const unavailable = await ctx.tools.execute({
      signal,
      callId: ToolCallId('plugin-confirm-unavailable-call'),
      name: 'plugin_manage',
      arguments: { action: 'confirm', confirmationToken: 'integration-token' },
      agent,
    })
    expect(unavailable).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('no user-questions answerer') }],
    })
    expect(manager.execute).not.toHaveBeenCalled()

    const seen: unknown[] = []
    ctx.on('user-questions/request', async request => {
        seen.push(request)
        return {
          answers: [{
            id: request.questions[0]!.id,
            selected: ['Approve plugin change'],
          }],
        }
    })
    const confirmed = await ctx.tools.execute({
      signal,
      callId: ToolCallId('plugin-confirm-call'),
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

  it('A-031 discovers, batch-plans, confirms once, and serially installs through real DSH services', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'relay-plugin-release-flow-'))
    cleanup.push(profileDir)
    const profilePath = join(profileDir, 'package.json')
    writeFileSync(profilePath, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))

    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(PluginSearchRuntime)

    const packages = ['plugin-a', 'plugin-b', 'plugin-c']
    ctx.pluginSearch.register({
      id: 'release-fixture',
      search: async () => packages.map((packageName, index) => ({
        id: packageName,
        title: packageName,
        sources: [{ kind: 'npm' as const, package: packageName }],
        score: packages.length - index,
      })),
    })
    const inspect = vi.fn(async (source: string | PluginSource): Promise<PluginInspection> => {
      const raw = typeof source === 'string'
        ? source
        : source.kind === 'npm' ? source.package : source.repo
      const versionAt = raw.lastIndexOf('@')
      const packageName = versionAt > 0 ? raw.slice(0, versionAt) : raw
      return {
        source: { kind: 'npm', package: packageName, version: '1.0.0' },
        sourceType: 'npm',
        requestedSpec: raw,
        installSpec: `${packageName}@1.0.0`,
        packageName,
        version: '1.0.0',
        integrity: 'sha512-dGVzdA==',
        repository: `github.com/example/${packageName}`,
        description: 'release flow fixture',
        bundlePatch: 'cordis.patch.yml',
        client: false,
        peerDependencies: packageName === 'plugin-a' ? { 'plugin-workbench': '^1.0.0' } : {},
      }
    })
    const calls: string[][] = []
    let activeRunners = 0
    let maxActiveRunners = 0
    const runPlugin = vi.fn(async (_profile: string, args: readonly string[]) => {
      calls.push([...args])
      activeRunners += 1
      maxActiveRunners = Math.max(maxActiveRunners, activeRunners)
      await Promise.resolve()
      const installSpec = args[2]!
      const versionAt = installSpec.lastIndexOf('@')
      const packageName = installSpec.slice(0, versionAt)
      const version = installSpec.slice(versionAt + 1)
      const packageDir = join(profileDir, 'node_modules', packageName)
      mkdirSync(packageDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
        name: packageName,
        version,
        dsh: { bundle: { patch: 'cordis.patch.yml' } },
      }))
      writeFileSync(join(packageDir, 'cordis.patch.yml'), `- insert:\n    - id: ${packageName}-entry\n      name: Fixture\n`)
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      profile.dependencies[packageName] = version
      profile.dsh.profile.bundles.push(packageName)
      writeFileSync(profilePath, JSON.stringify(profile))
      activeRunners -= 1
      return { exitCode: 0, signal: null, stdout: 'added', stderr: '', timedOut: false, cancelled: false }
    })
    const manager = new PluginManager({
      profileDir,
      searchRuntime: ctx.pluginSearch,
      inspect,
      runner: { runPlugin },
      hot: {
        activate: async () => ({ active: true, restartRequired: false, reason: null }),
        deactivate: async () => false,
        isActive: () => false,
      },
      restarter: { available: () => true, schedule: () => ({ helperPid: 1, logFile: '/tmp/restart.log' }) },
      loader: { entries: () => [] },
    })
    registerConversationSurface(ctx, manager)

    const sessionId = 'release-flow-session' as Agent['id']
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
    const execute = async (callId: string, name: string, args: Record<string, unknown>) => await ctx.tools.execute({
      signal,
      callId: ToolCallId(callId),
      name,
      arguments: args,
      agent,
    })

    try {
      const discovered = toolJson(await execute('release-discover', 'plugin_discover', {
        action: 'search', query: 'release suite', maxResults: 3,
      })) as SearchResult
      const sources = discovered.candidates.map(candidate => candidate.recommendedSource)
      expect(sources).toEqual(packages.map(packageName => `${packageName}@1.0.0`))

      const plan = toolJson(await execute('release-plan', 'plugin_manage', {
        action: 'plan', operation: 'install_many', sources,
      })) as ConfirmationPlan
      expect(plan).toMatchObject({
        action: 'install_many',
        items: packages.map(packageName => ({ packageName, installSpec: `${packageName}@1.0.0` })),
        missingPeerDependencies: [{
          packageName: 'plugin-workbench',
          ranges: ['^1.0.0'],
          requiredBy: ['plugin-a'],
          suggestedSource: 'plugin-workbench',
        }],
      })
      expect(runPlugin).not.toHaveBeenCalled()
      expect(JSON.parse(readFileSync(profilePath, 'utf8')).dependencies).toEqual({})

      const answer = deferred<{ answers: Array<{ id: string; selected: string[] }> }>()
      let question: AskUserQuestionRequest | undefined
      const ask = vi.fn(async (request: AskUserQuestionRequest) => {
        question = request
        return await answer.promise
      })
      ctx.on('user-questions/request', ask)
      const confirming = execute('release-confirm', 'plugin_manage', {
        action: 'confirm', confirmationToken: plan.confirmationToken,
      })
      await vi.waitFor(() => expect(question).toBeDefined())
      expect(runPlugin).not.toHaveBeenCalled()
      expect(JSON.parse(readFileSync(profilePath, 'utf8')).dependencies).toEqual({})
      expect(question?.questions[0]).toMatchObject({
        id: `plugin-plan:${plan.id}`,
        intent: { kind: 'plan-review', approve: 'Approve plugin change' },
      })
      expect(question?.questions[0]!.detail).toContain('Plugins:')
      expect(question?.questions[0]!.detail).toContain('Missing required peer dependencies:')
      for (const source of sources) expect(question?.questions[0]!.detail).toContain(source)

      answer.resolve({ answers: [{
        id: `plugin-plan:${plan.id}`,
        selected: ['Approve plugin change'],
      }] })
      const operation = toolJson(await confirming) as { id: string; status: string }
      expect(operation.status).toBe('queued')
      await expect(manager.wait(operation.id)).resolves.toMatchObject({
        action: 'install_many',
        status: 'succeeded',
        result: { items: packages.map(packageName => ({ packageName, status: 'succeeded' })) },
      })
      expect(calls).toEqual(packages.map(packageName => ['add', '--save-exact', `${packageName}@1.0.0`]))
      expect(maxActiveRunners).toBe(1)
      expect(JSON.parse(readFileSync(profilePath, 'utf8')).dependencies).toEqual(Object.fromEntries(
        packages.map(packageName => [packageName, '1.0.0']),
      ))

      const replay = await execute('release-replay', 'plugin_manage', {
        action: 'confirm', confirmationToken: plan.confirmationToken,
      })
      expect(replay.isError).toBe(true)
      expect(ask).toHaveBeenCalledOnce()
      expect(runPlugin).toHaveBeenCalledTimes(3)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
