import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import type { PackageSurface } from './profile.ts'

export interface HotInsertRow {
  id: string
  name: string
}

export interface HotActivationResult {
  active: boolean
  restartRequired: boolean
  reason: string | null
}

interface PluginHandle {
  await(): Promise<unknown>
  dispose(): Promise<unknown> | void
}

interface HotContext {
  plugin(plugin: unknown, config: unknown): PluginHandle
  logger?: { info?(message: string): void; warn?(message: string): void }
}

export function parseSimpleHotPatch(text: string): HotInsertRow[] | null {
  let value: unknown
  try {
    value = parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(value) || value.length === 0) return null
  const rows: HotInsertRow[] = []
  for (const patch of value) {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null
    if (Object.keys(patch).length !== 1 || !Array.isArray((patch as { insert?: unknown }).insert)) return null
    for (const raw of (patch as { insert: unknown[] }).insert) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
      const entry = raw as { id?: unknown; name?: unknown }
      if (Object.keys(entry).some(key => key !== 'id' && key !== 'name')) return null
      if (typeof entry.id !== 'string' || entry.id === '' || typeof entry.name !== 'string' || entry.name === '') return null
      rows.push({ id: entry.id, name: entry.name })
    }
  }
  return rows.length === 0 ? null : rows
}

export class HotRuntime {
  private readonly handles = new Map<string, PluginHandle>()
  private sequence = 0
  private includeClass: unknown | null | undefined
  private readonly ctx: HotContext
  private readonly profileDir: string
  private readonly timeoutMs: number
  private readonly loadInclude?: () => Promise<unknown | null>

  constructor(
    ctx: HotContext,
    profileDir: string,
    timeoutMs = 10_000,
    loadInclude?: () => Promise<unknown | null>,
  ) {
    this.ctx = ctx
    this.profileDir = profileDir
    this.timeoutMs = timeoutMs
    this.loadInclude = loadInclude
    this.clean()
  }

  private hotDir(): string {
    return join(this.profileDir, '.relay-plugin-manager')
  }

  clean(): void {
    let files: string[]
    try {
      files = readdirSync(this.hotDir())
    } catch {
      return
    }
    for (const file of files) if (/^hot-\d+\.yml$/u.test(file)) rmSync(join(this.hotDir(), file), { force: true })
  }

  private async include(): Promise<unknown | null> {
    if (this.includeClass !== undefined) return this.includeClass
    if (this.loadInclude !== undefined) {
      this.includeClass = await this.loadInclude()
      return this.includeClass
    }
    try {
      const module = await import('@deepseek-ai/cordis-plugin-include') as { Include?: new (...args: never[]) => object; default?: new (...args: never[]) => object }
      const Include = module.Include ?? module.default
      if (Include === undefined) throw new Error('missing Include export')
      this.includeClass = class RuntimeHotInclude extends Include {
        write(): void {}
      }
    } catch {
      this.includeClass = null
    }
    return this.includeClass
  }

  async activate(surface: PackageSurface): Promise<HotActivationResult> {
    if (this.handles.has(surface.packageName)) return { active: true, restartRequired: false, reason: null }
    const Include = await this.include()
    if (Include === null) return { active: false, restartRequired: true, reason: 'DSH Include runtime is unavailable.' }
    let rows: HotInsertRow[] | null = null
    if (surface.bundlePatch !== null) {
      try {
        rows = parseSimpleHotPatch(readFileSync(
          join(this.profileDir, 'node_modules', surface.packageName, surface.bundlePatch),
          'utf8',
        ))
      } catch {
        rows = null
      }
      if (rows === null) {
        return { active: false, restartRequired: true, reason: 'Bundle patch is not a plain insert-only patch.' }
      }
    } else if (surface.client) {
      rows = [{ id: `client-${surface.packageName.replace(/[^A-Za-z0-9_.-]/gu, '-')}`, name: surface.packageName }]
    } else {
      return { active: false, restartRequired: true, reason: 'Package has no hot-activatable DSH surface.' }
    }
    mkdirSync(this.hotDir(), { recursive: true, mode: 0o700 })
    const file = join(this.hotDir(), `hot-${String(++this.sequence)}.yml`)
    writeFileSync(file, rows.map(row => [
      '- id: ' + JSON.stringify(`rpm-${row.id}`),
      '  name: ' + JSON.stringify(row.name),
    ].join('\n')).join('\n') + '\n', { mode: 0o600 })
    let handle: PluginHandle | undefined
    let timeout: NodeJS.Timeout | undefined
    try {
      handle = this.ctx.plugin(Include, { path: pathToFileURL(file).href })
      await Promise.race([
        handle.await(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('hot activation timed out')), this.timeoutMs)
        }),
      ])
      this.handles.set(surface.packageName, handle)
      return { active: true, restartRequired: false, reason: null }
    } catch (error) {
      try { await handle?.dispose() } catch { /* best effort */ }
      return {
        active: false,
        restartRequired: true,
        reason: error instanceof Error ? error.message : String(error),
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async deactivate(packageName: string): Promise<boolean> {
    const handle = this.handles.get(packageName)
    if (handle === undefined) return false
    this.handles.delete(packageName)
    try {
      await handle.dispose()
      return true
    } catch {
      return false
    }
  }

  isActive(packageName: string): boolean {
    return this.handles.has(packageName)
  }
}
