import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelemetry } from '../../src/telemetry.ts'

const cleanup: string[] = []

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('opt-in anonymous telemetry', () => {
  it('does nothing and creates no identifier while disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-plugin-telemetry-'))
    cleanup.push(dir)
    const send = vi.fn<typeof fetch>()
    const telemetry = createTelemetry(dir, undefined, { fetch: send, random: () => crypto.randomUUID() })

    telemetry.capture('plugin_manager_used', { action: 'search' })

    expect(send).not.toHaveBeenCalled()
    expect(existsSync(join(dir, '.relay-plugin-manager'))).toBe(false)
  })

  it('sends personless events with a stable random id and no IP enrichment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-plugin-telemetry-'))
    cleanup.push(dir)
    const bodies: Array<Record<string, unknown>> = []
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 200 })
    })
    const id = '11111111-2222-4333-8444-555555555555'
    const runtime = { fetch: send, random: () => id }

    createTelemetry(dir, { enabled: true }, runtime).capture('plugin_manager_used', { action: 'search' })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    createTelemetry(dir, { enabled: true }, { ...runtime, random: () => crypto.randomUUID() })
      .capture('plugin_install_succeeded', { plugin_name: 'example-plugin' })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    const firstProperties = bodies[0]!.properties as Record<string, unknown>
    const secondProperties = bodies[1]!.properties as Record<string, unknown>
    expect(firstProperties).toMatchObject({
      distinct_id: id,
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
      product: 'relay-dsh-plugin-manager',
      action: 'search',
    })
    expect(secondProperties.distinct_id).toBe(id)
    expect(readFileSync(join(dir, '.relay-plugin-manager', 'telemetry.json'), 'utf8')).not.toContain(dir)
  })

  it('does not allow event properties to override privacy controls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-plugin-telemetry-'))
    cleanup.push(dir)
    const bodies: Array<Record<string, unknown>> = []
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 200 })
    })
    const telemetry = createTelemetry(dir, { enabled: true }, {
      fetch: send,
      random: () => '11111111-2222-4333-8444-555555555555',
    })

    telemetry.capture('plugin_manager_used', { $geoip_disable: false, $ip: '203.0.113.10' })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(bodies[0]!.properties).toMatchObject({ $geoip_disable: true, $ip: null })
  })

  it('rejects non-PostHog collection hosts when enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-plugin-telemetry-'))
    cleanup.push(dir)
    expect(() => createTelemetry(dir, { enabled: true, host: 'https://example.com' })).toThrow(/PostHog/u)
  })
})
