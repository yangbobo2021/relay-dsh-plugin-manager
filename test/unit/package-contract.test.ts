import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('PM-019/PM-020 package contract', () => {
  it('ships two Host rows with no client or public HTTP dependency surface', () => {
    const root = resolve(import.meta.dirname, '..', '..')
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const patch = parse(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'))

    expect(manifest.dsh).toEqual({ bundle: { patch: './cordis.patch.yml' } })
    expect(manifest.exports).not.toHaveProperty('./client')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-webserver')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-webserver')
    expect(manifest.files).not.toContain('keysync-prototype-2026-08-26')
    expect(patch).toEqual([{
      insert: [
        { id: 'relay-plugin-search-runtime', name: 'relay-dsh-plugin-manager/search' },
        { id: 'relay-plugin-manager-host', name: 'relay-dsh-plugin-manager' },
      ],
    }])
  })
})
