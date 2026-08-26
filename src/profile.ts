import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseDocument, type Document } from 'yaml'
import { fail } from './errors.ts'

export const MANAGER_PACKAGE = 'relay-dsh-plugin-manager'
const STATE_VERSION = 1
const STATE_DIR = '.relay-plugin-manager'

export interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export interface ManagerState {
  version: 1
  disabled: Record<string, string[]>
}

export interface PackageSurface {
  packageName: string
  source: string
  bundle: boolean
  bundlePatch: string | null
  client: boolean
  entryIds: string[] | null
}

export interface LoaderEntrySnapshot {
  id: string
  name?: string
  disabled: boolean
  phase: string | null
}

export interface PluginStatus {
  packageName: string
  source: string
  bundle: boolean
  enablement: 'enabled' | 'disabled' | 'mixed' | 'unknown'
  runtime: 'active' | 'inactive' | 'failed' | 'loading' | 'unknown'
  restartRequired: boolean
  entryIds: string[] | null
}

function readJsonObject<T extends object>(file: string, missing: T): T {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return missing
    return parsed as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missing
    fail('PROFILE_READ_FAILED', `Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function atomicWrite(file: string, text: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(temporary, text, { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    fail('PROFILE_WRITE_FAILED', `Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function writeProfileManifest(dir: string, manifest: ProfileManifest): void {
  atomicWrite(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

export function reconcileRemovedPackage(dir: string, packageName: string): void {
  const manifest = readProfileManifest(dir)
  if (manifest.dependencies !== undefined) delete manifest.dependencies[packageName]
  const bundles = manifest.dsh?.profile?.bundles
  if (bundles !== undefined) manifest.dsh!.profile!.bundles = bundles.filter(name => name !== packageName)
  writeProfileManifest(dir, manifest)
}

export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim()
  return resolve(configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured)
}

export function profileDirectory(profile = 'web', env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHome(env), 'profiles', profile)
}

export function readProfileManifest(dir: string): ProfileManifest {
  return readJsonObject<ProfileManifest>(join(dir, 'package.json'), {})
}

export function profileManifestText(dir: string): string | null {
  try {
    return readFileSync(join(dir, 'package.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    fail('PROFILE_READ_FAILED', `Could not read profile manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function restoreProfileManifest(dir: string, text: string | null): void {
  if (text === null) return
  atomicWrite(join(dir, 'package.json'), text)
}

function packageManifest(dir: string, packageName: string): Record<string, unknown> | null {
  const file = join(dir, 'node_modules', packageName, 'package.json')
  if (!existsSync(file)) return null
  return readJsonObject<Record<string, unknown>>(file, {})
}

export function bundleEntryIds(dir: string, packageName: string, patch: string): string[] | null {
  try {
    const document = parseDocument(readFileSync(join(dir, 'node_modules', packageName, patch), 'utf8'))
    if (document.errors.length > 0 || !Array.isArray(document.toJS())) return null
    const ids: string[] = []
    for (const row of document.toJS() as unknown[]) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
      const inserted = (row as { insert?: unknown }).insert
      if (!Array.isArray(inserted)) continue
      for (const entry of inserted) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
        const id = (entry as { id?: unknown }).id
        if (typeof id !== 'string' || id.trim() === '') return null
        if (!ids.includes(id)) ids.push(id)
      }
    }
    return ids.length === 0 ? null : ids
  } catch {
    return null
  }
}

export function packageSurface(dir: string, packageName: string, source: string): PackageSurface {
  const manifest = packageManifest(dir, packageName)
  const dsh = typeof manifest?.dsh === 'object' && manifest.dsh !== null && !Array.isArray(manifest.dsh)
    ? manifest.dsh as { bundle?: unknown; client?: unknown }
    : {}
  const bundle = typeof dsh.bundle === 'object' && dsh.bundle !== null && !Array.isArray(dsh.bundle)
    ? dsh.bundle as { patch?: unknown }
    : {}
  const patch = typeof bundle.patch === 'string' && bundle.patch.trim() !== '' ? bundle.patch : null
  return {
    packageName,
    source,
    bundle: patch !== null,
    bundlePatch: patch,
    client: dsh.client !== undefined,
    entryIds: patch === null ? null : bundleEntryIds(dir, packageName, patch),
  }
}

function statePath(dir: string): string {
  return join(dir, STATE_DIR, 'state.json')
}

export function readManagerState(dir: string): ManagerState {
  const state = readJsonObject<Partial<ManagerState>>(statePath(dir), {})
  const disabled: Record<string, string[]> = {}
  if (state.version === STATE_VERSION && typeof state.disabled === 'object' && state.disabled !== null) {
    for (const [name, ids] of Object.entries(state.disabled)) {
      if (Array.isArray(ids) && ids.every(id => typeof id === 'string')) disabled[name] = [...new Set(ids)]
    }
  }
  return { version: STATE_VERSION, disabled }
}

function writeManagerState(dir: string, state: ManagerState): void {
  atomicWrite(statePath(dir), `${JSON.stringify(state, null, 2)}\n`)
}

function patchDocument(file: string): Document.Parsed {
  let source = '[]\n'
  try {
    source = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail('PROFILE_READ_FAILED', `Could not read profile patch: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const document = parseDocument(source)
  if (document.errors.length > 0) fail('ENABLEMENT_CONFLICT', 'Profile cordis.patch.yml is not valid YAML.')
  const value = document.toJS()
  if (value === null) document.contents = document.createNode([]) as never
  else if (!Array.isArray(value)) fail('ENABLEMENT_CONFLICT', 'Profile cordis.patch.yml must contain a patch list.')
  return document
}

function exactDisabledRow(value: unknown, id: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 2 && (value as { id?: unknown }).id === id && (value as { disabled?: unknown }).disabled === true
}

export function disablePackage(dir: string, surface: PackageSurface): string[] {
  if (surface.packageName === MANAGER_PACKAGE) fail('PROTECTED_PLUGIN', 'The plugin manager cannot disable itself.')
  if (surface.entryIds === null || surface.entryIds.length === 0) {
    fail('ENABLEMENT_UNSUPPORTED', `${surface.packageName} has no safely attributable Loader entry ids.`)
  }
  const file = join(dir, 'cordis.patch.yml')
  const state = readManagerState(dir)
  const document = patchDocument(file)
  const rows = document.toJS() as unknown[]
  const alreadyOwned = new Set(state.disabled[surface.packageName] ?? [])
  for (const id of surface.entryIds) {
    const existing = rows.find(row => typeof row === 'object' && row !== null && !Array.isArray(row)
      && (row as { id?: unknown }).id === id)
    if (existing !== undefined && !(alreadyOwned.has(id) && exactDisabledRow(existing, id))) {
      fail('ENABLEMENT_CONFLICT', `Profile patch already owns Loader entry "${id}"; it will not be overwritten.`)
    }
    if (existing === undefined) document.add({ id, disabled: true })
  }
  state.disabled[surface.packageName] = [...surface.entryIds]
  atomicWrite(file, document.toString())
  writeManagerState(dir, state)
  return [...surface.entryIds]
}

export function enablePackage(dir: string, surface: PackageSurface): string[] {
  if (surface.packageName === MANAGER_PACKAGE) fail('PROTECTED_PLUGIN', 'The plugin manager cannot change its own enablement.')
  const state = readManagerState(dir)
  const owned = state.disabled[surface.packageName]
  if (owned === undefined || owned.length === 0) return []
  const file = join(dir, 'cordis.patch.yml')
  const document = patchDocument(file)
  const rows = document.toJS() as unknown[]
  for (const id of owned) {
    const matching = rows.filter(row => typeof row === 'object' && row !== null && !Array.isArray(row)
      && (row as { id?: unknown }).id === id)
    if (matching.some(row => !exactDisabledRow(row, id))) {
      fail('ENABLEMENT_CONFLICT', `Manager-owned Loader entry "${id}" was modified and will not be removed.`)
    }
  }
  const keep = rows.filter(row => !owned.some(id => exactDisabledRow(row, id)))
  document.contents = document.createNode(keep) as never
  delete state.disabled[surface.packageName]
  atomicWrite(file, document.toString())
  writeManagerState(dir, state)
  return [...owned]
}

function runtimeState(entries: LoaderEntrySnapshot[]): PluginStatus['runtime'] {
  const phases = entries.map(entry => entry.phase)
  if (phases.includes('failed')) return 'failed'
  if (phases.includes('active')) return 'active'
  if (phases.some(phase => phase === 'loading' || phase === 'pending')) return 'loading'
  if (entries.length > 0) return 'inactive'
  return 'unknown'
}

export function listPluginStatuses(dir: string, loaderEntries: readonly LoaderEntrySnapshot[] = []): PluginStatus[] {
  const manifest = readProfileManifest(dir)
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  const state = readManagerState(dir)
  return Object.entries(manifest.dependencies ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([packageName, source]) => {
    const surface = packageSurface(dir, packageName, source)
    const ids = surface.entryIds
    const entries = ids === null ? [] : loaderEntries.filter(entry => ids.includes(entry.id))
    let enablement: PluginStatus['enablement'] = 'unknown'
    if (ids !== null) {
      const disabledIds = new Set(state.disabled[packageName] ?? [])
      const disabled = ids.filter(id => disabledIds.has(id) || entries.some(entry => entry.id === id && entry.disabled)).length
      enablement = disabled === 0 ? 'enabled' : disabled === ids.length ? 'disabled' : 'mixed'
    }
    const runtime = runtimeState(entries)
    return {
      packageName,
      source,
      bundle: bundles.has(packageName) || surface.bundle,
      enablement,
      runtime,
      restartRequired: surface.bundle && runtime === 'unknown' && !state.disabled[packageName],
      entryIds: ids,
    }
  })
}
