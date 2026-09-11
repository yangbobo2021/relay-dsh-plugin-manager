import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import WebSocket from 'ws'

import { evaluateDshTaskSolutionRun } from './dsh-task-solution-evaluation.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const upstreamDirectory = resolve(process.env.DSH_UPSTREAM_DIR || join(repositoryRoot, '..', 'Relay', 'upstream', 'deepseek-harness'))
const dshCli = resolve(process.env.DSH_CLI_PATH || join(upstreamDirectory, 'apps', 'cli', 'lib', 'bin.js'))
const sourceProfile = resolve(process.env.DSH_E2E_PROFILE_SOURCE || join(homedir(), '.dsh', 'profiles', 'web'))
const registryRepository = resolve(process.env.DSH_E2E_REGISTRY_REPOSITORY || join(repositoryRoot, '..', 'Relay', 'dsh-plugin-registry'))
const registrySnapshotDirectory = resolve(process.env.DSH_E2E_REGISTRY_SNAPSHOT_DIRECTORY
  || join(registryRepository, '.artifacts', 'plugin-directory-reorganization', 'discovery.composite.2026-09-06.v1-0-5.b92b985e31df'))
const codexCommand = resolve(process.env.DSH_E2E_CODEX_COMMAND || '/Applications/ChatGPT.app/Contents/Resources/codex')
const model = process.env.DSH_E2E_MODEL || 'gpt-5.6-luna'
const reasoningEffort = process.env.DSH_E2E_REASONING_EFFORT || 'high'
const outputPath = process.env.DSH_TASK_SOLUTION_ACCEPTANCE_OUTPUT
  ? resolve(process.env.DSH_TASK_SOLUTION_ACCEPTANCE_OUTPUT)
  : null

for (const requiredPath of [dshCli, join(sourceProfile, 'package.json'), join(sourceProfile, 'node_modules'), codexCommand, registryRepository, join(registrySnapshotDirectory, 'plugins.jsonl'), join(registrySnapshotDirectory, 'export-manifest.json')]) {
  assert(existsSync(requiredPath), `Required DSH acceptance input is missing: ${requiredPath}`)
}
assert(existsSync(join(sourceProfile, 'node_modules', 'relay-dsh-plugin-codex')), 'The source DSH profile must contain relay-dsh-plugin-codex.')

const scenarios = [
  {
    id: 'process-result-to-lark',
    prompt: '请只使用 DSH 的 plugin_discover 工具，为“持续观察本地程序，程序结束后把结果发送到飞书”寻找最小完整插件方案。必须只执行一次 search_roles，完整 task 放在 query，maxResultsPerRole 设为 8，且每个 role query 不超过 120 字；search_roles 返回的候选已经过本地解析，请直接逐组审查这些候选的描述、来源和目录证据，然后执行一次 assess_solution，不要再调用 inspect。进程状态读取与负责重复检查、条件变化后恢复会话的持久监控是两个职责，不要用只提供通用 Event 传递的插件替代持久监控。每个职责只保留一个最匹配的主方案，不列备选。只做只读发现，不要安装，也不要规划安装；不要用无关候选填充缺失职责。',
    exactRoleCount: 3,
    roles: [
      {
        key: 'process_state_reader',
        roleMatchAny: ['进程状态', '程序状态', '退出状态', '退出结果'],
        solutionMatchAny: ['relay-dsh-plugin-monitor-process'],
      },
      {
        key: 'durable_monitor_scheduler',
        roleMatchAny: ['持久等待', '持续监控', '监控调度', '恢复会话', '恢复原会话'],
        solutionMatchAny: ['relay-dsh-plugin-monitors'],
      },
      {
        key: 'lark_result_delivery',
        roleMatchAny: ['飞书', 'lark'],
        solutionMatchAny: ['dsh-plug-notify', 'dsh-notify-hub', 'dsh-notify', 'dsh-lark-bot', 'dsh-lark-channel', 'dsh-lark'],
      },
    ],
  },
]

function run(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      cwd: options.cwd || repositoryRoot,
      env: options.env || process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : error.stdout?.toString() || ''
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString() || ''
    throw new Error(`${file} ${args.join(' ')} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`, { cause: error })
  }
}

async function reservePort() {
  const server = createServer()
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  assert(address && typeof address === 'object', 'Failed to reserve a local DSH port.')
  await new Promise(resolveClose => server.close(resolveClose))
  return address.port
}

async function startLocalRegistry() {
  const { createRegistryServer, listen } = await import(pathToFileURL(join(registryRepository, 'apps/web/src/server.mjs')).href)
  const { createSemanticDirectoryIndex } = await import(pathToFileURL(join(registryRepository, 'packages/registry-store/src/semantic-directory-index.mjs')).href)
  const { discoverySnapshotContentDigest } = await import(pathToFileURL(join(registryRepository, 'packages/contracts/src/discovery.mjs')).href)
  const { loadSemanticDirectoryPublication } = await import(pathToFileURL(join(registryRepository, 'scripts/database/semantic-directory-files.mjs')).href)
  const publication = JSON.parse(await readFile(join(registryRepository, 'data/publications/public.2026-09-03.5f40e5afda/candidate-search-response.json'), 'utf8'))
  const oldSnapshot = JSON.parse(await readFile(join(registryRepository, 'data/discovery-snapshots/discovery.composite.2026-09-05.v1-0-4.8bbaabff92b0/discovery-snapshot.json'), 'utf8'))
  const exportManifest = JSON.parse(await readFile(join(registrySnapshotDirectory, 'export-manifest.json'), 'utf8'))
  const entries = (await readFile(join(registrySnapshotDirectory, 'plugins.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.equal(entries.length, exportManifest.entry_count, 'Frozen Registry export entry count does not match its manifest.')
  const categoryDistribution = Object.fromEntries([...new Set(entries.map(entry => entry.category.id))]
    .sort().map(category => [category, entries.filter(entry => entry.category.id === category).length]))
  const discoverySnapshot = {
    ...oldSnapshot,
    snapshot_id: exportManifest.snapshot_id,
    generated_at: exportManifest.exported_at,
    normalization_version: '1.0.5',
    source: {
      ...oldSnapshot.source,
      name: 'dsh-plugin-registry-production-export',
      fetched_at: exportManifest.exported_at,
      source_updated: exportManifest.exported_at.slice(0, 10),
      raw_sha256: exportManifest.content_sha256,
    },
    entries,
    manifest: {
      ...oldSnapshot.manifest,
      raw_count: entries.length,
      normalized_count: entries.length,
      eligible_count: entries.length,
      coverage_ratio: 1,
      category_distribution: categoryDistribution,
      npm_source_count: entries.filter(entry => entry.sources.some(source => source.kind === 'npm')).length,
      github_source_count: entries.filter(entry => entry.sources.some(source => source.kind === 'github')).length,
      duplicate_repositories: [],
      malformed_records: [],
      policy_exclusions: [],
    },
  }
  discoverySnapshot.manifest.content_sha256 = discoverySnapshotContentDigest(discoverySnapshot)
  const loadedDirectory = await loadSemanticDirectoryPublication(join(registryRepository, 'data/semantic-directories/plugin-directory-semantic-v3-18'))
  assert.equal(loadedDirectory.snapshot.source_catalog_snapshot_id, discoverySnapshot.snapshot_id, 'Semantic directory and Registry export must reference the same snapshot.')
  const semanticDirectory = createSemanticDirectoryIndex(loadedDirectory.snapshot)
  const server = createRegistryServer({
    publication,
    discoverySnapshot,
    semanticDirectory,
    operatorPreview: true,
    release: 'local-task-solution-acceptance',
    semanticDirectoryStatus: semanticDirectory.metadata(),
  })
  const address = await listen(server, { host: '127.0.0.1', port: 0 })
  assert(address && typeof address === 'object', 'Local Registry failed to bind.')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    directoryVersion: loadedDirectory.snapshot.directory_version,
    discoveryEntries: discoverySnapshot.entries.length,
    exportDigest: exportManifest.content_sha256,
    snapshotDigest: discoverySnapshot.manifest.content_sha256,
    close: () => new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())),
  }
}

async function until(predicate, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMilliseconds}ms.`)
    await new Promise(resolveWait => setTimeout(resolveWait, 1500))
  }
}

function parseJsonObject(value) {
  if (value !== null && typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try { return JSON.parse(value) } catch { return null }
}

function activitySummary(activity) {
  return {
    type: activity?.type,
    name: activity?.name || activity?.toolName || activity?.tool || activity?.title,
    status: activity?.status,
    input: parseJsonObject(activity?.input || activity?.arguments),
    output: parseJsonObject(activity?.output),
  }
}

function compactCandidate(candidate) {
  return {
    identity: candidate?.identity,
    packageName: candidate?.packageName,
    repository: candidate?.repository,
    semanticMatches: candidate?.semanticMatches,
    recommendedSource: candidate?.recommendedSource,
    rank: candidate?.rank,
  }
}

function compactActivity(activity) {
  const output = activity.output
  const action = activity.input?.action
  if (action === 'search_roles' && output !== null) {
    return {
      ...activity,
      output: {
        schemaVersion: output.schemaVersion,
        solutionId: output.solutionId,
        task: output.task,
        status: output.status,
        ambiguities: output.ambiguities,
        roles: output.roles?.map(role => ({
          id: role.id,
          label: role.label,
          query: role.query,
          required: role.required,
          providerErrors: role.providerErrors,
          rejectedCandidates: role.rejectedCandidates,
          candidates: role.candidates?.map(compactCandidate),
        })),
      },
    }
  }
  if (action === 'inspect') {
    return {
      ...activity,
      output: output === null ? null : {
        packageName: output.packageName,
        version: output.version,
        description: output.description,
        source: output.source,
        repository: output.repository,
        bundle: output.bundle,
      },
    }
  }
  return activity
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dsh-plugin-manager-conversation-'))
const dshHome = join(temporaryDirectory, 'home')
const profileDirectory = join(dshHome, 'profiles', 'web')
const moduleDirectory = join(profileDirectory, 'node_modules')
const artifactDirectory = join(temporaryDirectory, 'artifacts')
let child
let hostLog = ''
let localRegistry

try {
  localRegistry = await startLocalRegistry()
  await mkdir(moduleDirectory, { recursive: true })
  await mkdir(artifactDirectory, { recursive: true })
  const sourceManifest = JSON.parse(await readFile(join(sourceProfile, 'package.json'), 'utf8'))
  const packageManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const candidateManifest = structuredClone(sourceManifest)
  candidateManifest.dependencies = {
    ...candidateManifest.dependencies,
    [packageManifest.name]: `file:${join(artifactDirectory, `${packageManifest.name}-${packageManifest.version}.tgz`)}`,
  }
  candidateManifest.dsh ??= {}
  candidateManifest.dsh.profile ??= {}
  candidateManifest.dsh.profile.bundles = [...new Set([
    ...(candidateManifest.dsh.profile.bundles || []),
    packageManifest.name,
  ])]
  await writeFile(join(profileDirectory, 'package.json'), `${JSON.stringify(candidateManifest, null, 2)}\n`)
  await writeFile(join(profileDirectory, 'cordis.yml'), '[]\n')
  await writeFile(join(profileDirectory, 'cordis.patch.yml'), `- id: relay-codex-host\n  config:\n    codexCommand: ${JSON.stringify(codexCommand)}\n`)
  await writeFile(join(dshHome, 'settings.yaml'), `permission:\n  defaultPreset: read-only\nagent-default-model:\n  provider: relay-codex\n  model: ${model}\n  reasoningEffort: ${reasoningEffort}\n`)

  for (const entry of await readdir(join(sourceProfile, 'node_modules'))) {
    if (entry === packageManifest.name) continue
    await symlink(join(sourceProfile, 'node_modules', entry), join(moduleDirectory, entry))
  }
  if (!existsSync(join(moduleDirectory, 'yaml'))) {
    await symlink(join(repositoryRoot, 'node_modules', 'yaml'), join(moduleDirectory, 'yaml'))
  }

  const archiveName = `${packageManifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${packageManifest.version}.tgz`
  run('npm', ['pack', '--silent', '--pack-destination', artifactDirectory], { cwd: repositoryRoot })
  const archivePath = join(artifactDirectory, archiveName)
  const installedManager = join(moduleDirectory, packageManifest.name)
  await mkdir(installedManager)
  run('tar', ['-xzf', archivePath, '--strip-components=1', '-C', installedManager])

  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const environment = {
    ...process.env,
    DSH_HOME: dshHome,
    RELAY_CODEX_COMMAND: codexCommand,
    RELAY_CODEX_LINK_PATH: join(temporaryDirectory, 'links.json'),
    RELAY_PLUGIN_MANAGER_TELEMETRY: '0',
    DSH_PLUGIN_REGISTRY_URL: localRegistry.origin,
  }
  child = spawn(process.execPath, ['--expose-internals', dshCli, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: repositoryRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => { hostLog += chunk.toString() })
  child.stderr.on('data', chunk => { hostLog += chunk.toString() })
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`DSH exited with ${child.exitCode}.\n${hostLog.slice(-8000)}`)
    return hostLog.includes(baseUrl)
  }, 60_000)

  const launchToken = /dsh web: http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s]+)/u.exec(hostLog)?.[1]
  assert(launchToken, 'DSH did not print its one-use browser launch token.')
  const authorization = await fetch(`${baseUrl}/?token=${encodeURIComponent(launchToken)}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  assert([302, 303].includes(authorization.status), 'DSH browser-token exchange did not redirect.')
  const cookie = authorization.headers.get('set-cookie')?.split(';', 1)[0]
  assert(cookie, 'DSH browser-token exchange did not return a session cookie.')

  async function rpc(endpoint, args) {
    const response = await fetch(`${baseUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
      signal: AbortSignal.timeout(30_000),
    })
    const responseText = await response.text()
    assert.equal(response.status, 200, `${endpoint}: HTTP ${response.status}: ${responseText}`)
    const body = JSON.parse(responseText)
    assert.equal(body.result?.ok, true, `${endpoint}: ${JSON.stringify(body)}`)
    return body.result.value
  }

  async function sessionCursor(sessionId) {
    const socket = new WebSocket(`${baseUrl.replace(/^http/u, 'ws')}/api/remote.mux`, { headers: { cookie } })
    const streamId = `task-solution-history-${randomUUID()}`
    try {
      await new Promise((resolveOpen, rejectOpen) => {
        socket.once('open', resolveOpen)
        socket.once('error', rejectOpen)
      })
      return await new Promise((resolveCursor, rejectCursor) => {
        const timer = setTimeout(() => rejectCursor(new Error('session/follow did not publish an opening cursor.')), 15_000)
        socket.on('message', value => {
          try {
            const frame = JSON.parse(value.toString())
            if (frame.streamId !== streamId) return
            if (frame.type === 'error') throw new Error(`session/follow failed: ${JSON.stringify(frame.error)}`)
            if (frame.type === 'item' && frame.value?.type === 'snapshot' && Number.isSafeInteger(frame.value.cursor)) {
              clearTimeout(timer)
              resolveCursor(frame.value.cursor)
            }
          } catch (error) {
            clearTimeout(timer)
            rejectCursor(error)
          }
        })
        socket.send(JSON.stringify({
          type: 'open',
          streamId,
          endpoint: 'session/follow',
          payload: { args: { request: { address: { kind: 'session', sessionId }, maxMessages: 50 } } },
        }))
      })
    } finally {
      socket.close()
    }
  }

  async function sessionHistory(sessionId) {
    const throughSeq = await sessionCursor(sessionId)
    return rpc('session/page', {
      request: { address: { kind: 'session', sessionId }, throughSeq, maxMessages: 50 },
    })
  }

  const results = []
  for (const scenario of scenarios) {
    const { workspace } = await rpc('workspace/create', { request: { path: repositoryRoot } })
    const { sessionId } = await rpc('session/create', { request: { workspaceId: workspace.workspaceId, agentPreset: 'relay-codex' } })
    await rpc('session/selectModel', { request: { sessionId, provider: 'relay-codex', model, reasoningEffort } })
    await rpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: scenario.prompt }] } })
    await until(async () => {
      const list = await rpc('session/list', { _request: {} })
      const session = list.items.find(item => item.sessionId === sessionId)
      return session !== undefined && session.blank === false && session.running === false
    }, 420_000)
    const history = await sessionHistory(sessionId)
    await writeFile(join(artifactDirectory, `${scenario.id}.history.json`), `${JSON.stringify(history, null, 2)}\n`)
    const events = history.records
      .filter(record => record.type === 'event')
      .map(record => record.event)
    const activities = events
      .filter(event => event.type === 'tool/result')
      .map(event => event.data.meta?.codexActivity?.activity)
      .filter(Boolean)
      .map(activitySummary)
    const finalText = events
      .filter(event => event.type === 'assistant/message')
      .flatMap(event => event.data.message?.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const turnEnd = events.findLast(event => event.type === 'turn/end')?.data
    results.push({ id: scenario.id, session_id: sessionId, turn_end: turnEnd, activities, final_text: finalText })
  }

  const metadata = {
    generated_at: new Date().toISOString(),
    model,
    reasoning_effort: reasoningEffort,
    dsh_commit: run('git', ['rev-parse', 'HEAD'], { cwd: upstreamDirectory }).trim(),
    candidate: `${packageManifest.name}@${packageManifest.version}`,
    source_profile: basename(sourceProfile),
    registry: {
      source: 'local frozen public data',
      discovery_entries: localRegistry.discoveryEntries,
      directory_version: localRegistry.directoryVersion,
      export_digest: localRegistry.exportDigest,
      snapshot_digest: localRegistry.snapshotDigest,
    },
  }
  const evaluation = evaluateDshTaskSolutionRun(scenarios, results, metadata)
  const report = {
    ...evaluation,
    conversations: results.map(result => ({
      ...result,
      activities: result.activities.map(compactActivity),
    })),
  }
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    passed: report.passed,
    model,
    reasoning_effort: reasoningEffort,
    registry: report.registry,
    scenarios: report.results,
    report_path: outputPath,
  }, null, 2))
  assert(report.passed, 'Live DSH task-solution acceptance failed.')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolveExit => child.once('exit', resolveExit))
    child.kill('SIGINT')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await exited
    clearTimeout(timer)
  }
  if (localRegistry) await localRegistry.close()
  await writeFile(join(temporaryDirectory, 'host.log'), hostLog).catch(() => undefined)
  if (process.env.DSH_TASK_SOLUTION_KEEP_ARTIFACTS !== '1') {
    await rm(temporaryDirectory, { recursive: true, force: true })
  } else {
    process.stderr.write(`DSH task-solution artifacts: ${temporaryDirectory}\n`)
  }
}
