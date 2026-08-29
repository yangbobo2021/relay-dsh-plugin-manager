import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamDir = process.env.DSH_UPSTREAM_DIR === undefined
  ? resolve(packageDir, '..', '..', 'upstream', 'deepseek-harness')
  : resolve(process.env.DSH_UPSTREAM_DIR)
const cli = process.env.DSH_CLI_PATH === undefined
  ? join(upstreamDir, 'apps', 'cli', 'lib', 'bin.js')
  : resolve(process.env.DSH_CLI_PATH)
const inspectUpstream = existsSync(join(upstreamDir, '.git'))
const require = createRequire(import.meta.url)

function run(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      cwd: options.cwd ?? packageDir,
      env: options.env ?? process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : error.stdout?.toString() ?? ''
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString() ?? ''
    throw new Error(`${file} ${args.join(' ')} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`, { cause: error })
  }
}

if (!existsSync(cli)) throw new Error(`DSH CLI is missing: ${cli}`)
const temporary = mkdtempSync(join(tmpdir(), 'relay-plugin-manager-e2e-'))
const packDir = join(temporary, 'pack')
const dshHome = join(temporary, 'dsh-home')
mkdirSync(packDir, { recursive: true })
const before = inspectUpstream
  ? run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: upstreamDir })
  : null

try {
  const packageManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const archiveName = String(packageManifest.name).replace(/^@/u, '').replaceAll('/', '-')
  const filename = `${archiveName}-${String(packageManifest.version)}.tgz`
  run('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: packageDir })
  const tarball = join(packDir, filename)
  if (!existsSync(tarball)) throw new Error(`npm pack did not create ${filename}`)
  const env = { ...process.env, DSH_HOME: dshHome }

  run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', '--save-exact', tarball], { env })
  const profileDir = join(dshHome, 'profiles', 'web')
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const dependency = manifest.dependencies?.['relay-dsh-plugin-manager']
  if (typeof dependency !== 'string') throw new Error('profile has no relay-dsh-plugin-manager dependency')
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.filter(name => name === 'relay-dsh-plugin-manager').length !== 1) {
    throw new Error('profile must contain relay-dsh-plugin-manager exactly once in dsh.profile.bundles')
  }

  const installedDir = join(profileDir, 'node_modules', 'relay-dsh-plugin-manager')
  const installedManifest = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'))
  if (installedManifest.exports?.['./client']?.default !== './lib/client.js') {
    throw new Error('installed package does not export the client bundle')
  }
  if (installedManifest.dsh?.client?.platform !== 'web') {
    throw new Error('installed package does not declare a Web client')
  }

  let clientModule
  runInNewContext(readFileSync(join(installedDir, 'lib', 'client.js'), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load(descriptor) { clientModule = descriptor },
      },
    },
  })
  if (clientModule?.id !== 'relay-dsh-plugin-manager' || typeof clientModule.factory !== 'function') {
    throw new Error('client bundle did not register the expected module')
  }
  const client = clientModule.factory(specifier => require(specifier))
  if (JSON.stringify(client.inject) !== JSON.stringify(['slots', 'locale'])) {
    throw new Error('client bundle requests more than slots and locale')
  }
  let dictionaries
  let tab
  client.apply({
    effect(setup) { setup() },
    locale: {
      register(namespace, value) { dictionaries = { namespace, value } },
      bind() { return key => dictionaries.value.zh[key] },
    },
    slots: {
      inject(name, contribution) {
        if (name !== 'settings.plugins.tab') throw new Error(`unexpected client slot ${name}`)
        contribution()
      },
      register(options, component) {
        tab = { options, component }
        return () => undefined
      },
    },
  })
  if (dictionaries?.namespace !== 'settings.pluginMarketplace') {
    throw new Error('client bundle did not register its locale namespace')
  }
  if (tab?.options?.id !== 'marketplace' || tab.options.order !== -10 || tab.options.inject !== undefined) {
    throw new Error('client bundle did not register the read-only marketplace tab')
  }
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const html = renderToStaticMarkup(React.createElement(tab.component, {
    t: key => dictionaries.value.zh[key],
  }))
  for (const packageName of ['relay-dsh-plugin-claude', 'relay-dsh-plugin-codex']) {
    if (!html.includes(packageName)) {
      throw new Error(`marketplace tab is missing recommended plugin ${packageName}`)
    }
  }
  const recommendedCount = (html.match(/data-recommended-plugin/gu) ?? []).length
  if (recommendedCount !== 2) {
    throw new Error('marketplace tab must render one card per recommended plugin')
  }
  // Each install line must carry its package name, so an install request never
  // depends on a registry search, and the reader never assembles the message.
  const promptCount = (html.match(/data-chat-prompt="true"/gu) ?? []).length
  if (promptCount !== recommendedCount) {
    throw new Error('marketplace tab must render one complete install message per plugin')
  }
  if (!html.includes('想安装/查看/卸载其他插件？')) {
    throw new Error('marketplace tab is missing its Chinese guidance for other plugins')
  }
  if (/<(?:button|input|form|a)\b/u.test(html)) {
    throw new Error('marketplace tab must not render management controls')
  }

  const dump = run(process.execPath, [cli, '--profile', 'web', '--dump-config'], { env })
  for (const expected of [
    'relay-plugin-search-runtime',
    'relay-dsh-plugin-manager/search',
    'relay-plugin-manager-host',
    "name: relay-dsh-plugin-manager",
  ]) {
    if (!dump.includes(expected)) throw new Error(`dump-config is missing ${JSON.stringify(expected)}`)
  }

  const after = inspectUpstream
    ? run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: upstreamDir })
    : null
  if (after !== before) throw new Error('official DSH checkout changed during package acceptance')
  const commit = inspectUpstream
    ? run('git', ['rev-parse', 'HEAD'], { cwd: upstreamDir }).trim()
    : null
  process.stdout.write(`${JSON.stringify({
    accepted: true,
    package: 'relay-dsh-plugin-manager',
    dependency,
    bundleEntries: ['relay-plugin-search-runtime', 'relay-plugin-manager-host'],
    clientTab: { id: tab.options.id, order: tab.options.order, recommendedCount, promptCount, controls: 0 },
    dshCommit: commit,
    upstreamStatusUnchanged: inspectUpstream,
  }, null, 2)}\n`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
