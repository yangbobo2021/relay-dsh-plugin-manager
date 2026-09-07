import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const DEFAULT_ENDPOINT = 'https://dsh-plugins.tech/v1/telemetry/events'
const STATE_DIRECTORY = '.relay-plugin-manager'
const STATE_FILE = 'telemetry.json'
const SCHEMA_VERSION = '1.1.0'
const EVENTS = new Set([
  'plugin_manager_used',
  'plugin_install_started',
  'plugin_install_succeeded',
  'plugin_install_failed',
])

export type TelemetryProperty = string | number | boolean

export interface Telemetry {
  capture(event: string, properties?: Readonly<Record<string, TelemetryProperty>>): void
}

export interface TelemetryConfig {
  /** Anonymous operational telemetry is enabled unless this is explicitly false. */
  enabled?: boolean
  /** Registry telemetry endpoint. Only the canonical service or localhost is accepted. */
  endpoint?: string
  /** Marks an operator-controlled acceptance run so analytics can exclude it. */
  test?: boolean
}

interface TelemetryRuntime {
  fetch: typeof fetch
  random(): string
}

const noopTelemetry: Telemetry = Object.freeze({ capture() {} })

function safeEndpoint(value: string | undefined): string | null {
  try {
    const parsed = new URL(value ?? DEFAULT_ENDPOINT)
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    const canonical = parsed.protocol === 'https:' && parsed.hostname === 'dsh-plugins.tech'
    if ((!local && !canonical) || (local && !['http:', 'https:'].includes(parsed.protocol))) return null
    if (parsed.username !== '' || parsed.password !== '' || parsed.pathname !== '/v1/telemetry/events'
      || parsed.search !== '' || parsed.hash !== '') return null
    return parsed.href
  } catch {
    return null
  }
}

function anonymousId(profileDir: string, random: () => string): string {
  const directory = join(profileDir, STATE_DIRECTORY)
  const path = join(directory, STATE_FILE)
  try {
    const existing = JSON.parse(readFileSync(path, 'utf8')) as { anonymousId?: unknown }
    if (typeof existing.anonymousId === 'string' && /^[0-9a-f-]{36}$/iu.test(existing.anonymousId)) {
      return existing.anonymousId
    }
  } catch {
    // A missing or damaged local state file is replaced below.
  }
  const id = random()
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ anonymousId: id })}\n`, { mode: 0o600 })
  } catch {
    // Telemetry must never block plugin management; the process-scoped id still works.
  }
  return id
}

function allowedProperties(event: string, properties: Readonly<Record<string, TelemetryProperty>>): boolean {
  const keys = new Set(Object.keys(properties))
  const exact = (required: readonly string[], optional: readonly string[] = []): boolean => {
    if (required.some(key => !keys.has(key))) return false
    return [...keys].every(key => required.includes(key) || optional.includes(key))
  }
  if (event === 'plugin_manager_used') {
    if (!exact(['surface', 'action'], ['has_query', 'query_length_bucket', 'batch_size'])) return false
    if (!['discover', 'plan'].includes(String(properties.surface))) return false
    return typeof properties.action === 'string'
  }
  if (event === 'plugin_install_started') return exact(['plugin_name'], ['batch'])
  if (event === 'plugin_install_succeeded') return exact(['plugin_name', 'activated', 'restart_required'], ['batch'])
  if (event === 'plugin_install_failed') return exact(['plugin_name', 'error_code'], ['batch'])
  return false
}

export function createTelemetry(
  profileDir: string,
  config: TelemetryConfig | undefined,
  runtime: TelemetryRuntime = { fetch, random: randomUUID },
): Telemetry {
  if (config?.enabled === false) return noopTelemetry
  const endpoint = safeEndpoint(config?.endpoint)
  if (endpoint === null) return noopTelemetry
  let distinctId: string | undefined

  return Object.freeze({
    capture(event: string, properties: Readonly<Record<string, TelemetryProperty>> = {}): void {
      if (!EVENTS.has(event) || !allowedProperties(event, properties)) return
      distinctId ??= anonymousId(profileDir, runtime.random)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      timeout.unref?.()
      try {
        void runtime.fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema_version: SCHEMA_VERSION,
            anonymous_id: distinctId,
            event,
            properties,
            ...(config?.test === true ? { is_test: true } : {}),
          }),
          signal: controller.signal,
        }).catch(() => undefined).finally(() => clearTimeout(timeout))
      } catch {
        clearTimeout(timeout)
      }
    },
  })
}
