import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const DEFAULT_HOST = 'https://us.i.posthog.com'
const DEFAULT_PROJECT_KEY = 'phc_t7C34XS2fUwwnxy9SbjWfCNZPiTkx88QnbeovfWqkkrr'
const STATE_DIRECTORY = '.relay-plugin-manager'
const STATE_FILE = 'telemetry.json'

export type TelemetryProperty = string | number | boolean

export interface Telemetry {
  capture(event: string, properties?: Readonly<Record<string, TelemetryProperty>>): void
}

export interface TelemetryConfig {
  /** Anonymous product analytics are disabled unless this is explicitly true. */
  enabled?: boolean
  /** Override only when routing events to another PostHog project. */
  host?: string
  /** PostHog browser-facing project key. This is not a personal API key. */
  projectKey?: string
}

interface TelemetryRuntime {
  fetch: typeof fetch
  random(): string
}

const noopTelemetry: Telemetry = Object.freeze({ capture() {} })

function safeHost(value: string | undefined): string {
  const parsed = new URL(value ?? DEFAULT_HOST)
  if (parsed.protocol !== 'https:' || !/(^|\.)i\.posthog\.com$/u.test(parsed.hostname)) {
    throw new Error('Telemetry host must be an HTTPS PostHog ingestion origin.')
  }
  return parsed.origin
}

function safeProjectKey(value: string | undefined): string {
  const key = value ?? DEFAULT_PROJECT_KEY
  if (!/^phc_[A-Za-z0-9_-]{20,}$/u.test(key)) throw new Error('Telemetry project key is invalid.')
  return key
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
    // Analytics must never block plugin management; the process-scoped id still works.
  }
  return id
}

export function createTelemetry(
  profileDir: string,
  config: TelemetryConfig | undefined,
  runtime: TelemetryRuntime = { fetch, random: randomUUID },
): Telemetry {
  if (config?.enabled !== true) return noopTelemetry
  const host = safeHost(config.host)
  const projectKey = safeProjectKey(config.projectKey)
  const distinctId = anonymousId(profileDir, runtime.random)

  return Object.freeze({
    capture(event: string, properties: Readonly<Record<string, TelemetryProperty>> = {}): void {
      if (!/^[a-z][a-z0-9_]{2,63}$/u.test(event)) return
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1_500)
      timeout.unref?.()
      void runtime.fetch(`${host}/capture/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: projectKey,
          event,
          properties: {
            ...properties,
            distinct_id: distinctId,
            $process_person_profile: false,
            $geoip_disable: true,
            $ip: null,
            product: 'relay-dsh-plugin-manager',
          },
        }),
        signal: controller.signal,
      }).catch(() => undefined).finally(() => clearTimeout(timeout))
    },
  })
}
