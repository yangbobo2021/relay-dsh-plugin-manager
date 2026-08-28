import { fail } from './errors.ts'

export const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
export const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
export const FULL_COMMIT = /^[a-f0-9]{40}$/iu
const GITHUB_PART = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/u
const UNSAFE_TOKEN = /[\u0000-\u0020\u007f;&|`$<>]/u

export interface NpmPluginSource {
  kind: 'npm'
  package: string
  version?: string
}

export interface GithubPluginSource {
  kind: 'github'
  owner: string
  repo: string
  ref?: string
}

export type PluginSource = NpmPluginSource | GithubPluginSource

export interface PluginInspection {
  source: PluginSource
  sourceType: PluginSource['kind']
  requestedSpec: string
  installSpec: string
  packageName: string
  version?: string
  commit?: string
  integrity?: string
  repository: string | null
  description: string | null
  bundlePatch: string | null
  client: boolean
  peerDependencies: Record<string, string>
}

function manifestPeerDependencies(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const peers = (value as { peerDependencies?: unknown }).peerDependencies
  if (typeof peers !== 'object' || peers === null || Array.isArray(peers)) return {}
  return Object.fromEntries(Object.entries(peers).flatMap(([name, range]) => {
    if (!NPM_NAME.test(name) || typeof range !== 'string') return []
    const normalized = range.trim()
    return normalized === '' || normalized.length > 500 ? [] : [[name, normalized]]
  }))
}

export interface FetchOptions {
  fetch?: typeof globalThis.fetch
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

function safeToken(value: unknown): string {
  const source = String(value ?? '').trim()
  if (source === '' || source.startsWith('-') || UNSAFE_TOKEN.test(source)) {
    fail('INVALID_SOURCE', 'Plugin source must be one safe npm or GitHub token.')
  }
  return source
}

export function parseNpmSpec(value: unknown, requireExact = false): NpmPluginSource {
  const spec = safeToken(value)
  let packageName = spec
  let version: string | undefined
  const separator = spec.lastIndexOf('@')
  const scopedBoundary = spec.startsWith('@') ? spec.indexOf('/') : -1
  if (separator > Math.max(0, scopedBoundary)) {
    packageName = spec.slice(0, separator)
    version = spec.slice(separator + 1)
  }
  if (!NPM_NAME.test(packageName)) {
    fail('INVALID_NPM_SPEC', 'Plugin source is not a valid npm package name.')
  }
  if (version !== undefined && !EXACT_SEMVER.test(version)) {
    fail('INVALID_NPM_VERSION', 'npm plugin versions must be exact semantic versions.')
  }
  if (requireExact && version === undefined) {
    fail('IMMUTABLE_SOURCE_REQUIRED', 'Installation requires an exact npm version.')
  }
  return { kind: 'npm', package: packageName, ...(version === undefined ? {} : { version }) }
}

function validGithubPart(value: string): boolean {
  return GITHUB_PART.test(value) && value !== '.' && value !== '..' && !value.endsWith('.git')
}

export function parseGithubSpec(value: unknown, requireCommit = false): GithubPluginSource | null {
  const spec = safeToken(value)
  let owner: string | undefined
  let repo: string | undefined
  let ref: string | undefined
  if (spec.startsWith('github:')) {
    const match = /^github:([^/]+)\/([^#]+?)(?:#(.+))?$/u.exec(spec)
    if (match === null) fail('INVALID_GITHUB_SPEC', 'GitHub source must use github:owner/repo[#ref].')
    owner = match[1]
    repo = match[2]
    ref = match[3]
  } else if (spec.startsWith('https://github.com/')) {
    let url: URL
    try {
      url = new URL(spec)
    } catch {
      fail('INVALID_GITHUB_SPEC', 'GitHub URL is invalid.')
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search !== '') {
      fail('INVALID_GITHUB_SPEC', 'Only canonical HTTPS github.com repository URLs are supported.')
    }
    const parts = url.pathname.split('/').filter(Boolean)
    owner = parts[0]
    repo = parts[1]?.replace(/\.git$/u, '')
    if (parts.length > 2) {
      if ((parts[2] !== 'tree' && parts[2] !== 'commit') || parts.length < 4) {
        fail('INVALID_GITHUB_SPEC', 'GitHub URL must identify a repository, tree, or commit.')
      }
      ref = decodeURIComponent(parts.slice(3).join('/'))
    } else if (url.hash !== '') {
      fail('INVALID_GITHUB_SPEC', 'Use a tree/commit URL or github:owner/repo#ref for GitHub refs.')
    }
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(spec)) {
    fail('INVALID_GITHUB_SPEC', 'Only canonical HTTPS github.com repository URLs are supported.')
  } else {
    return null
  }
  if (!validGithubPart(owner ?? '') || !validGithubPart(repo ?? '')) {
    fail('INVALID_GITHUB_SPEC', 'GitHub owner or repository name is invalid.')
  }
  if (ref !== undefined && (ref === '' || ref.length > 200 || UNSAFE_TOKEN.test(ref))) {
    fail('INVALID_GITHUB_REF', 'GitHub ref is invalid.')
  }
  if (requireCommit && !FULL_COMMIT.test(ref ?? '')) {
    fail('IMMUTABLE_SOURCE_REQUIRED', 'Installation requires a full GitHub commit.')
  }
  return { kind: 'github', owner: owner!, repo: repo!, ...(ref === undefined ? {} : { ref }) }
}

export function parsePluginSource(value: string | PluginSource): PluginSource {
  if (typeof value === 'string') return parseGithubSpec(value) ?? parseNpmSpec(value)
  if (value.kind === 'npm') {
    return parseNpmSpec(`${value.package}${value.version === undefined ? '' : `@${value.version}`}`)
  }
  return parseGithubSpec(`github:${value.owner}/${value.repo}${value.ref === undefined ? '' : `#${value.ref}`}`)!
}

export function renderSource(source: PluginSource): string {
  if (source.kind === 'npm') return `${source.package}${source.version === undefined ? '' : `@${source.version}`}`
  return `github:${source.owner}/${source.repo}${source.ref === undefined ? '' : `#${source.ref}`}`
}

function manifestDsh(value: unknown): { bundlePatch: string | null; client: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { bundlePatch: null, client: false }
  const dsh = (value as { dsh?: unknown }).dsh
  if (typeof dsh !== 'object' || dsh === null || Array.isArray(dsh)) return { bundlePatch: null, client: false }
  const bundle = (dsh as { bundle?: unknown }).bundle
  const patch = typeof bundle === 'object' && bundle !== null && !Array.isArray(bundle)
    ? (bundle as { patch?: unknown }).patch
    : undefined
  return {
    bundlePatch: typeof patch === 'string' && patch.trim() !== '' ? patch : null,
    client: (dsh as { client?: unknown }).client !== undefined,
  }
}

export function validatePluginManifest(
  manifest: unknown,
  expectedName?: string,
): { packageName: string; bundlePatch: string | null; client: boolean } {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    fail('INVALID_PLUGIN_MANIFEST', 'Plugin package manifest must be an object.')
  }
  const packageName = String((manifest as { name?: unknown }).name ?? '')
  if (!NPM_NAME.test(packageName)) fail('INVALID_PLUGIN_MANIFEST', 'Plugin manifest has no valid package name.')
  if (expectedName !== undefined && packageName !== expectedName) {
    fail('PACKAGE_NAME_MISMATCH', 'Resolved package name does not match the requested npm package.')
  }
  const surface = manifestDsh(manifest)
  if (surface.bundlePatch === null && !surface.client) {
    fail('NOT_DSH_PLUGIN', `${packageName} declares neither dsh.bundle.patch nor dsh.client.`)
  }
  return { packageName, ...surface }
}

async function fetchJson(url: string, options: FetchOptions, headers: Record<string, string> = {}): Promise<unknown> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json', ...headers },
      redirect: 'follow',
      signal: options.signal,
    })
  } catch (error) {
    fail('NETWORK_ERROR', `Could not reach plugin source: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) fail('SOURCE_HTTP_ERROR', `Plugin source returned HTTP ${response.status}.`, { url, status: response.status })
  try {
    return await response.json()
  } catch {
    fail('INVALID_SOURCE_METADATA', 'Plugin source returned invalid JSON metadata.', { url })
  }
}

function repositoryIdentity(value: unknown): string | null {
  const raw = typeof value === 'string'
    ? value
    : typeof value === 'object' && value !== null
      ? (value as { url?: unknown }).url
      : undefined
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const normalized = raw.trim()
    .replace(/^git\+/u, '')
    .replace(/^git@github\.com:/u, 'https://github.com/')
    .replace(/^github:/u, 'https://github.com/')
    .replace(/\.git(?:#.*)?$/u, '')
    .replace(/\/$/u, '')
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/iu.exec(normalized)
  return match === null
    ? normalized.toLowerCase()
    : `github.com/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`
}

function npmMetadataUrl(name: string, version?: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/u, '@')}/${encodeURIComponent(version ?? 'latest')}`
}

export async function inspectNpm(source: NpmPluginSource, options: FetchOptions = {}): Promise<PluginInspection> {
  const manifest = await fetchJson(npmMetadataUrl(source.package, source.version), options)
  const plugin = validatePluginManifest(manifest, source.package)
  const version = String((manifest as { version?: unknown }).version ?? '')
  if (!EXACT_SEMVER.test(version)) fail('INVALID_NPM_VERSION', 'Registry metadata has no exact semantic version.')
  const integrity = (manifest as { dist?: { integrity?: unknown } }).dist?.integrity
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/=]+$/u.test(integrity)) {
    fail('NPM_INTEGRITY_MISSING', 'Registry metadata has no SHA-512 package integrity.')
  }
  const exact: NpmPluginSource = { kind: 'npm', package: plugin.packageName, version }
  return {
    source: exact,
    sourceType: 'npm',
    requestedSpec: renderSource(source),
    installSpec: renderSource(exact),
    packageName: plugin.packageName,
    version,
    integrity,
    repository: repositoryIdentity((manifest as { repository?: unknown }).repository),
    description: typeof (manifest as { description?: unknown }).description === 'string'
      ? (manifest as { description: string }).description
      : null,
    bundlePatch: plugin.bundlePatch,
    client: plugin.client,
    peerDependencies: manifestPeerDependencies(manifest),
  }
}

function githubHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN
  return {
    'user-agent': 'relay-dsh-plugin-manager',
    'x-github-api-version': '2022-11-28',
    ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
  }
}

export async function inspectGithub(source: GithubPluginSource, options: FetchOptions = {}): Promise<PluginInspection> {
  const headers = githubHeaders(options.env)
  let ref = source.ref
  if (ref === undefined) {
    const repository = await fetchJson(`https://api.github.com/repos/${source.owner}/${source.repo}`, options, headers)
    ref = typeof (repository as { default_branch?: unknown }).default_branch === 'string'
      ? (repository as { default_branch: string }).default_branch
      : undefined
    if (ref === undefined || ref === '') fail('INVALID_SOURCE_METADATA', 'GitHub repository has no default branch.')
  }
  const commit = await fetchJson(
    `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(ref)}`,
    options,
    headers,
  )
  const sha = String((commit as { sha?: unknown }).sha ?? '').toLowerCase()
  if (!FULL_COMMIT.test(sha)) fail('INVALID_SOURCE_METADATA', 'GitHub did not resolve the source to a full commit.')
  const manifest = await fetchJson(
    `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${sha}/package.json`,
    options,
  )
  const plugin = validatePluginManifest(manifest)
  const exact: GithubPluginSource = { kind: 'github', owner: source.owner, repo: source.repo, ref: sha }
  return {
    source: exact,
    sourceType: 'github',
    requestedSpec: renderSource(source),
    installSpec: renderSource(exact),
    packageName: plugin.packageName,
    commit: sha,
    repository: `github.com/${source.owner.toLowerCase()}/${source.repo.toLowerCase()}`,
    description: typeof (manifest as { description?: unknown }).description === 'string'
      ? (manifest as { description: string }).description
      : null,
    bundlePatch: plugin.bundlePatch,
    client: plugin.client,
    peerDependencies: manifestPeerDependencies(manifest),
  }
}

export async function inspectPluginSource(
  value: string | PluginSource,
  options: FetchOptions = {},
): Promise<PluginInspection> {
  const source = parsePluginSource(value)
  return source.kind === 'npm' ? inspectNpm(source, options) : inspectGithub(source, options)
}

export function inspectionIdentity(inspection: PluginInspection): string {
  return inspection.repository ?? `${inspection.sourceType}:${inspection.packageName.toLowerCase()}`
}
