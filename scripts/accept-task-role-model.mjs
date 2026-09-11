import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateTaskRoleModelPlans, validateTaskRoleModelSuite } from './task-role-model-evaluation.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const suitePath = join(repositoryRoot, 'fixtures/evaluation/task-role-model-scenarios.v1.json')
const schemaPath = join(repositoryRoot, 'fixtures/evaluation/task-role-model-output.schema.json')
const command = process.env.DSH_TASK_ROLE_CODEX_COMMAND || 'codex'
const model = process.env.DSH_TASK_ROLE_MODEL || 'gpt-5.6-luna'
const reasoningEffort = process.env.DSH_TASK_ROLE_REASONING_EFFORT || 'high'
const timeoutMilliseconds = Number.parseInt(process.env.DSH_TASK_ROLE_TIMEOUT_MS || '600000', 10)

assert(Number.isInteger(timeoutMilliseconds) && timeoutMilliseconds >= 1000, 'DSH_TASK_ROLE_TIMEOUT_MS must be at least 1000.')

function buildPrompt(suite) {
  const tasks = suite.cases.flatMap(scenario => ['zh-CN', 'en'].map(locale => ({
    scenario_id: scenario.scenario_id,
    locale,
    task: scenario.task[locale],
  })))
  return `You are designing search roles for a plugin manager. Evaluate every task independently.

For each task, produce the smallest set of mutually distinct plugin capabilities needed to solve it completely.

Rules:
- A role is one independently searchable responsibility/capability, not merely a workflow step and not a guessed implementation mechanism.
- Decompose by coverage responsibility even when one plugin might cover several roles; the later assessment can merge one shared plugin across roles.
- Keep coherent operations on the same resource in one user-facing role. For example, browsing, filtering, and previewing files together are one file-browser responsibility, not separate discovery and preview roles.
- The cross-time boundary below is the deliberate exception: reading a source-specific state and durably waiting/scheduling a later state change with session resumption are distinct responsibilities.
- Therefore, every ongoing observation that finishes later must have both (1) a source-specific state/event reader and (2) a durable monitor/scheduler that survives the wait and resumes the original session. Never merge those two coverage roles, even if one plugin could implement both.
- Separate capabilities when they require meaningfully different plugin types.
- Mark a role required=false only when the task explicitly makes it optional (for example, "preferably" or "最好").
- If a required choice is unspecified and changes which capability should be searched (for example, an unspecified notification channel), record an ambiguity instead of inventing a role for one option.
- Do not add terminal, shell, transport, UI, storage, or scheduling roles unless the task itself requires that distinct capability.
- Labels and search queries must preserve the task's concrete domain terms. Use the same language as the task.
- IDs must be concise ASCII snake_case and unique within a plan.
- Return exactly one plan for every input item and preserve scenario_id and locale exactly.

Tasks:
${JSON.stringify(tasks, null, 2)}`
}

function runCodex(args, prompt, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const outputLimit = 200_000
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-outputLimit) })
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-outputLimit) })
    child.once('error', rejectPromise)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      rejectPromise(new Error(`Codex task-role evaluation timed out after ${timeoutMilliseconds}ms.`))
    }, timeoutMilliseconds)
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolvePromise({ stdout, stderr })
      else rejectPromise(new Error(`Codex exited with code ${code}.\n${stderr.slice(-4000)}`))
    })
    child.stdin.end(prompt)
  })
}

const suite = validateTaskRoleModelSuite(JSON.parse(await readFile(suitePath, 'utf8')))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dsh-task-role-acceptance-'))
const modelOutputPath = join(temporaryDirectory, 'model-output.json')

try {
  const args = [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--color', 'never',
    '--output-schema', schemaPath,
    '--output-last-message', modelOutputPath,
    '--model', model,
    '--config', `model_reasoning_effort="${reasoningEffort}"`,
    '-',
  ]
  await runCodex(args, buildPrompt(suite), { cwd: temporaryDirectory })
  const modelOutput = JSON.parse(await readFile(modelOutputPath, 'utf8'))
  const report = evaluateTaskRoleModelPlans(suite, modelOutput, {
    runner: 'codex-exec',
    model,
    reasoning_effort: reasoningEffort,
    command,
  })
  const outputPath = process.env.DSH_TASK_ROLE_ACCEPTANCE_OUTPUT
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    passed: report.passed,
    suite_id: report.suite_id,
    model,
    reasoning_effort: reasoningEffort,
    metrics: report.metrics,
    failed_plans: report.results.filter(result => !result.passed).map(result => ({
      scenario_id: result.scenario_id,
      locale: result.locale,
      failures: result.failures,
    })),
    report_path: outputPath ? resolve(outputPath) : null,
  }, null, 2))
  assert(report.passed, 'Live task-role model acceptance failed.')
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
