import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelemetry } from '../../src/telemetry.ts'

const cleanup: string[] = []
const id = '11111111-2222-4333-8444-555555555555'

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function temporaryProfile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-plugin-telemetry-'))
  cleanup.push(dir)
  return dir
}

describe('default-on first-party anonymous telemetry', () => {
  it('sends a versioned Registry envelope by default and creates the identifier lazily', async () => {
    const dir = await temporaryProfile()
    const bodies: Array<Record<string, unknown>> = []
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 202 })
    })
    const telemetry = createTelemetry(dir, undefined, { fetch: send, random: () => id })
    expect(existsSync(join(dir, '.relay-plugin-manager'))).toBe(false)

    telemetry.capture('plugin_manager_used', {
      surface: 'discover', action: 'search', has_query: true, query_length_bucket: '11-30',
    })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(send.mock.calls[0]?.[0]).toBe('https://dsh-plugins.tech/v1/telemetry/events')
    expect(bodies[0]).toEqual({
      schema_version: '1.0.0',
      anonymous_id: id,
      event: 'plugin_manager_used',
      properties: { surface: 'discover', action: 'search', has_query: true, query_length_bucket: '11-30' },
    })
    expect(JSON.stringify(bodies[0])).not.toMatch(/api_key|posthog|\$ip|profile|query.*secret/iu)
    expect(readFileSync(join(dir, '.relay-plugin-manager', 'telemetry.json'), 'utf8')).not.toContain(dir)
  })

  it('reuses one stable random identifier across manager processes', async () => {
    const dir = await temporaryProfile()
    const bodies: Array<Record<string, unknown>> = []
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 202 })
    })
    const runtime = { fetch: send, random: () => id }

    createTelemetry(dir, undefined, runtime).capture('plugin_install_started', { plugin_name: 'example-plugin' })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    createTelemetry(dir, undefined, { ...runtime, random: () => crypto.randomUUID() })
      .capture('plugin_install_succeeded', {
        plugin_name: 'example-plugin', activated: true, restart_required: false,
      })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    expect(bodies.map(body => body.anonymous_id)).toEqual([id, id])
  })

  it('creates no identifier and sends nothing when explicitly disabled', async () => {
    const dir = await temporaryProfile()
    const send = vi.fn<typeof fetch>()
    const telemetry = createTelemetry(dir, { enabled: false }, { fetch: send, random: () => id })

    telemetry.capture('plugin_install_started', { plugin_name: 'example-plugin' })

    expect(send).not.toHaveBeenCalled()
    expect(existsSync(join(dir, '.relay-plugin-manager'))).toBe(false)
  })

  it('drops unknown fields and non-Registry destinations before network delivery', async () => {
    const dir = await temporaryProfile()
    const send = vi.fn<typeof fetch>()
    const telemetry = createTelemetry(dir, undefined, { fetch: send, random: () => id })

    telemetry.capture('plugin_manager_used', {
      surface: 'discover', action: 'search', query: 'private terms',
    })
    createTelemetry(dir, { endpoint: 'https://example.com/v1/telemetry/events' }, { fetch: send, random: () => id })
      .capture('plugin_install_started', { plugin_name: 'example-plugin' })

    expect(send).not.toHaveBeenCalled()
    expect(existsSync(join(dir, '.relay-plugin-manager'))).toBe(false)
  })

  it('allows the exact localhost endpoint for development tests', async () => {
    const dir = await temporaryProfile()
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }))
    createTelemetry(dir, { endpoint: 'http://127.0.0.1:4174/v1/telemetry/events' }, { fetch: send, random: () => id })
      .capture('plugin_install_failed', { plugin_name: 'example-plugin', error_code: 'NETWORK_ERROR', batch: true })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  })

  it('never throws when delivery fails synchronously', async () => {
    const dir = await temporaryProfile()
    const send = vi.fn<typeof fetch>(() => { throw new Error('offline') })
    const telemetry = createTelemetry(dir, undefined, { fetch: send, random: () => id })
    expect(() => telemetry.capture('plugin_install_started', { plugin_name: 'example-plugin' })).not.toThrow()
  })
})
