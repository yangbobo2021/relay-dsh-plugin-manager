import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  disablePackage,
  enablePackage,
  listPluginStatuses,
  packageSurface,
  readManagerState,
} from '../../src/profile.ts'

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-plugin-profile-'))
  mkdirSync(join(dir, 'node_modules', 'example-plugin'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    dependencies: { 'example-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['example-plugin'] } },
  }))
  writeFileSync(join(dir, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({
    name: 'example-plugin',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'node_modules', 'example-plugin', 'cordis.patch.yml'), [
    '- insert:',
    '    - id: example-host',
    "      name: 'example-plugin'",
    '    - id: example-tool',
    "      name: 'example-plugin/tool'",
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
  return dir
}

describe('PM-003/PM-012/PM-014 profile and enablement projection', () => {
  it('projects installed bundle status from manifest, package patch, and Loader entries', () => {
    const dir = fixture()
    expect(listPluginStatuses(dir, [
      { id: 'example-host', name: 'example-plugin', disabled: false, phase: 'active' },
      { id: 'example-tool', name: 'example-plugin/tool', disabled: false, phase: 'active' },
    ])).toEqual([{
      packageName: 'example-plugin',
      source: '1.0.0',
      bundle: true,
      enablement: 'enabled',
      runtime: 'active',
      restartRequired: false,
      entryIds: ['example-host', 'example-tool'],
    }])
  })

  it('disables with manager-owned rows and enables by removing only those rows', () => {
    const dir = fixture()
    const surface = packageSurface(dir, 'example-plugin', '1.0.0')
    expect(disablePackage(dir, surface)).toEqual(['example-host', 'example-tool'])
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('disabled: true')
    expect(readManagerState(dir).disabled).toEqual({
      'example-plugin': ['example-host', 'example-tool'],
    })
    expect(listPluginStatuses(dir)[0]?.enablement).toBe('disabled')

    expect(enablePackage(dir, surface)).toEqual(['example-host', 'example-tool'])
    expect(readManagerState(dir).disabled).toEqual({})
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8').trim()).toBe('[]')
  })

  it('does not overwrite a user-owned patch row', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'cordis.patch.yml'), '- id: example-host\n  disabled: false\n')
    expect(() => disablePackage(dir, packageSurface(dir, 'example-plugin', '1.0.0')))
      .toThrow(/will not be overwritten/)
  })

  it('reports mixed state and protects the manager from self-disable', () => {
    const dir = fixture()
    expect(listPluginStatuses(dir, [
      { id: 'example-host', disabled: true, phase: null },
      { id: 'example-tool', disabled: false, phase: 'active' },
    ])[0]?.enablement).toBe('mixed')
    expect(() => disablePackage(dir, {
      packageName: 'relay-dsh-plugin-manager', source: '0.1.0', bundle: true,
      bundlePatch: './cordis.patch.yml', client: false, entryIds: ['relay-plugin-manager-host'],
    })).toThrow(/cannot disable itself/)
  })
})
