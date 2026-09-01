// No public publishing or model calls. The real manager and official CLI operate
// on two synthetic package versions served by a loopback npm-compatible registry.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DshCliRunner } from '../src/runner.ts'

const run = promisify(execFile)
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = resolve(process.env.DSH_UPSTREAM_DIR ?? join(packageDir, '../../upstream/deepseek-harness'))
const cli = resolve(process.env.DSH_CLI_PATH ?? join(upstream, 'apps/cli/lib/bin.js'))
const dshVersion = JSON.parse(await readFile(join(dirname(dirname(cli)), 'package.json'), 'utf8')).version
const legacyHost = dshVersion === '0.1.1-rc.2'
const home = await mkdtemp(join(tmpdir(), 'relay-manager-controlled-'))
const profileDir = join(home, 'profiles/web')
const marker = join(home, 'activation.txt')
const env = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), RELAY_LIFECYCLE_MARKER: marker }
// Unique package identity ensures repeated runs fetch both synthetic archives;
// a shared pnpm content cache must not silently replace that transport check.
const fixtureName = `@relay-controlled/dsh-plugin-fixture-${home.slice(-6).toLowerCase()}`
const fixtureId = 'relay-controlled-fixture-host'
const versions = new Map()
const hits = []
const steps = []
let registry
let registryUrl

async function official(args) {
  return await run(process.execPath, [cli, ...args], { cwd: upstream, env, maxBuffer: 8 * 1024 * 1024, timeout: 180_000 })
}
async function manifest() { return JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) }
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise(resolveDone => child.once('close', resolveDone))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  await done
  clearTimeout(timer)
}
function redact(text) { return text.replace(/token=[^\s]+/g, 'token=[REDACTED]') }
async function boot(expectedVersion, label) {
  await rm(marker, { force: true })
  const child = spawn(process.execPath, ['--expose-internals', cli, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: upstream, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-64 * 1024) })
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-64 * 1024) })
  try {
    const deadline = Date.now() + 45_000
    let launch
    while (!(launch = output.match(legacyHost ? /http:\/\/127\.0\.0\.1:\d+\/?/ : /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0])) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`${label}: host failed to boot\n${redact(output)}`)
      await new Promise(resolveWait => setTimeout(resolveWait, 50))
    }
    const login = await fetch(launch, { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (!legacyHost) assert.ok(cookie, `${label}: launch token exchanges for authentication cookie`)
    const page = await fetch(new URL('/', launch), { headers: cookie ? { cookie } : {} })
    assert.equal(page.status, 200, `${label}: authenticated Web boot`)
    await page.text()
    if (expectedVersion === null) assert.equal(existsSync(marker), false, `${label}: plugin must not activate`)
    else assert.equal((await readFile(marker, 'utf8')).trim(), expectedVersion, `${label}: actual loaded plugin version`)
    steps.push({ id: label, status: 'passed', authenticatedWebStatus: 200, activatedVersion: expectedVersion })
  } finally { await stop(child) }
}

try {
  assert.equal((await run('git', ['status', '--short'], { cwd: upstream })).stdout.trim(), '')
  await run('npm', ['run', 'build'], { cwd: packageDir, maxBuffer: 8 * 1024 * 1024 })
  const packed = JSON.parse((await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', home], { cwd: packageDir, maxBuffer: 8 * 1024 * 1024 })).stdout)[0]
  const tarball = join(home, packed.filename)
  const managerSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
  await official(['plugin', '--profile', 'web', 'add', '--save-exact', tarball])
  // Outside DSH's module resolver, optional host peers resolve from dev deps.
  // Verify these are the exact same built bytes as the installed candidate.
  assert.deepEqual(await readFile(join(packageDir, 'lib/index.js')), await readFile(join(profileDir, 'node_modules/relay-dsh-plugin-manager/lib/index.js')))
  const { PluginManager } = await import(join(packageDir, 'lib/index.js'))
  for (const version of ['1.0.0', '1.0.1']) {
    const directory = join(home, `fixture-${version}`)
    await mkdir(directory)
    const metadata = { name: fixtureName, version, type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }
    await writeFile(join(directory, 'package.json'), JSON.stringify(metadata))
    await writeFile(join(directory, 'cordis.patch.yml'), `- insert:\n    - id: ${fixtureId}\n      name: '${fixtureName}'\n`)
    await writeFile(join(directory, 'index.js'), `import { appendFileSync } from 'node:fs';\nexport function apply() { appendFileSync(process.env.RELAY_LIFECYCLE_MARKER, ${JSON.stringify(version + '\n')}); }\n`)
    const fixturePack = JSON.parse((await run('npm', ['pack', '--json', '--pack-destination', home], { cwd: directory })).stdout)[0]
    const bytes = await readFile(join(home, fixturePack.filename))
    versions.set(version, { metadata, bytes, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` })
  }
  const resolvedMetadata = version => {
    const item = versions.get(version)
    return { ...item.metadata, dist: { tarball: `${registryUrl}/${fixtureName}/-/${version}.tgz`, integrity: item.integrity } }
  }
  registry = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, registryUrl).pathname)
    hits.push(pathname)
    const archive = pathname.match(/\/-\/(1\.0\.[01])\.tgz$/)?.[1]
    if (archive) { response.end(versions.get(archive).bytes); return }
    response.setHeader('content-type', 'application/json')
    if (pathname === `/${fixtureName}`) {
      response.end(JSON.stringify({ name: fixtureName, 'dist-tags': { latest: '1.0.1' }, versions: Object.fromEntries([...versions.keys()].map(version => [version, resolvedMetadata(version)])),
        // Fixed synthetic publication dates model existing fixture releases.
        time: { created: '2000-01-01T00:00:00.000Z', modified: '2000-01-02T00:00:00.000Z', '1.0.0': '2000-01-01T00:00:00.000Z', '1.0.1': '2000-01-02T00:00:00.000Z' },
      }))
      return
    }
    const version = pathname.slice(`/${fixtureName}/`.length)
    if (pathname.startsWith(`/${fixtureName}/`) && (versions.has(version) || version === 'latest')) {
      response.end(JSON.stringify(resolvedMetadata(version === 'latest' ? '1.0.1' : version))); return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'Only the controlled fixture is served by this registry.' }))
  })
  await new Promise(resolveListen => registry.listen(0, '127.0.0.1', resolveListen))
  registryUrl = `http://127.0.0.1:${registry.address().port}`
  await writeFile(join(profileDir, '.npmrc'), `@relay-controlled:registry=${registryUrl}\n`)
  const officialRunner = new DshCliRunner({ env, argv: ['node', cli], execPath: process.execPath, cwd: upstream, timeoutMs: 120_000 })
  let lastCommand
  let commandCount = 0
  const manager = new PluginManager({
    profileDir, searchRuntime: { entries: () => [] },
    runner: { runPlugin: async (...args) => { commandCount++; lastCommand = await officialRunner.runPlugin(...args); return lastCommand } },
    fetchOptions: { fetch: async (url, options) => {
      const source = new URL(url)
      assert.equal(source.host, 'registry.npmjs.org')
      assert.ok(decodeURIComponent(source.pathname).startsWith(`/${fixtureName}/`))
      return await fetch(new URL(source.pathname, registryUrl), options)
    } },
    // A standalone controller cannot hot-activate another process. Assert the
    // honest restart-required result, then verify activation in real cold boots.
    hot: { isActive: () => false, activate: async () => ({ active: false, restartRequired: true, reason: 'Controlled acceptance uses a separate host process.' }), deactivate: async () => false },
    restarter: { available: () => false, schedule: () => { throw new Error('Use explicit fixture cold boot.') } },
    hmrTimeoutMs: 20,
  })
  async function execute(request) {
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const commandsBefore = commandCount
    const plan = await manager.plan(request)
    assert.equal(await readFile(join(profileDir, 'package.json'), 'utf8'), before, 'planning leaves profile unchanged')
    assert.throws(() => manager.execute('not-a-confirmation-token'), { code: 'CONFIRMATION_REQUIRED' })
    assert.equal(await readFile(join(profileDir, 'package.json'), 'utf8'), before, 'unconfirmed mutation leaves profile unchanged')
    assert.equal(commandCount, commandsBefore, 'no official mutation command runs before confirmation')
    const operation = manager.execute(plan.confirmationToken)
    assert.throws(() => manager.execute(plan.confirmationToken), { code: 'CONFIRMATION_REPLAYED' })
    const completed = await manager.wait(operation.id)
    assert.ok(['succeeded', 'waiting_for_manual_restart'].includes(completed.status), redact(JSON.stringify({ error: completed.error, command: lastCommand })))
    steps.push({ id: `manager-${request.operation}`, status: 'passed', completion: completed.status, confirmationRequired: true, tokenReplayRejected: true })
    return completed
  }
  const inspection = await manager.discover({ action: 'inspect', target: `${fixtureName}@1.0.0` })
  assert.equal(inspection.integrity, versions.get('1.0.0').integrity)
  await execute({ operation: 'install', source: `${fixtureName}@1.0.0` })
  assert.equal((await manifest()).dependencies[fixtureName], '1.0.0')
  await boot('1.0.0', 'installed-cold-boot')
  await execute({ operation: 'disable', target: fixtureName })
  await boot(null, 'disabled-cold-boot')
  await execute({ operation: 'enable', target: fixtureName })
  await boot('1.0.0', 'enabled-cold-boot')
  await execute({ operation: 'update', target: fixtureName, source: `${fixtureName}@1.0.1` })
  assert.equal((await manifest()).dependencies[fixtureName], '1.0.1')
  await boot('1.0.1', 'updated-cold-boot')
  await execute({ operation: 'remove', target: fixtureName })
  assert.equal((await manifest()).dependencies[fixtureName], undefined)
  assert.equal((await manifest()).dsh.profile.bundles.includes(fixtureName), false)
  await boot(null, 'removed-cold-boot')
  assert.ok(hits.includes(`/${fixtureName}/-/1.0.0.tgz`))
  assert.ok(hits.includes(`/${fixtureName}/-/1.0.1.tgz`))
  assert.equal((await run('git', ['status', '--short'], { cwd: upstream })).stdout.trim(), '')
  const evidence = {
    dshVersion,
    dshCommit: legacyHost ? 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' : (await run('git', ['rev-parse', 'HEAD'], { cwd: upstream })).stdout.trim(),
    managerSha256, platform: process.platform, arch: process.arch, node: process.version,
    registry: 'loopback-controlled-fixture', fixturePackage: fixtureName, fixtureVersions: [...versions].map(([version, item]) => ({ version, integrity: item.integrity })), steps,
    notCovered: ['public npm/GitHub lifecycle', 'conversation approval UI and session-bound tokens', 'hot reload', 'batch failure/cancellation', 'all real plugin dependencies'],
  }
  if (process.env.RELAY_LIFECYCLE_EVIDENCE) await writeFile(resolve(process.env.RELAY_LIFECYCLE_EVIDENCE), JSON.stringify(evidence, null, 2) + '\n')
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n')
} finally {
  if (registry) await new Promise(resolveClose => registry.close(resolveClose))
  await rm(home, { recursive: true, force: true })
}
