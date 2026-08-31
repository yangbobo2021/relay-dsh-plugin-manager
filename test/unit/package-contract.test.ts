import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('PM-019/PM-020 package contract', () => {
  it('ships two Host rows plus only the read-only Settings client surface', () => {
    const root = resolve(import.meta.dirname, '..', '..')
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const patch = parse(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'))

    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-settings',
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-session',
          '@deepseek-ai/dsh-api-session-controller',
          '@deepseek-ai/dsh-api-workspace-controller',
        ],
        platform: 'web',
      },
    })
    expect(manifest.exports['./client']).toEqual({ default: './lib/client.js' })
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-webserver')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-webserver')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-user-questions']).toBe('>=0.1.2-alpha.2 <0.1.3')
    expect(manifest.peerDependenciesMeta['@deepseek-ai/dsh-user-questions']).toEqual({ optional: true })
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-api-remotes')
    expect(manifest.files).toContain('README.zh.md')
    expect(manifest.files).not.toContain('keysync-prototype-2026-08-26')
    expect(patch).toEqual([{
      insert: [
        { id: 'relay-plugin-search-runtime', name: 'relay-dsh-plugin-manager/search' },
        { id: 'relay-plugin-manager-host', name: 'relay-dsh-plugin-manager' },
      ],
    }])
  })
})
