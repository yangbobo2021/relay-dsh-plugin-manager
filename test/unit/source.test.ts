import { describe, expect, it, vi } from 'vitest'
import {
  inspectPluginSource,
  parseGithubSpec,
  parseNpmSpec,
  validatePluginManifest,
} from '../../src/source.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PM-007/PM-008/PM-018 source parsing and inspection', () => {
  it('parses npm package names and requires exact versions for execution', () => {
    expect(parseNpmSpec('@relay/plugin')).toEqual({ kind: 'npm', package: '@relay/plugin' })
    expect(parseNpmSpec('@relay/plugin@1.2.3', true)).toEqual({
      kind: 'npm', package: '@relay/plugin', version: '1.2.3',
    })
    expect(() => parseNpmSpec('plugin@latest')).toThrow(/exact semantic/)
    expect(() => parseNpmSpec('plugin', true)).toThrow(/exact npm version/)
  })

  it('parses canonical GitHub forms and rejects unsafe or unsupported sources', () => {
    expect(parseGithubSpec('github:owner/repo#main')).toEqual({
      kind: 'github', owner: 'owner', repo: 'repo', ref: 'main',
    })
    expect(parseGithubSpec('https://github.com/owner/repo/tree/release')).toEqual({
      kind: 'github', owner: 'owner', repo: 'repo', ref: 'release',
    })
    expect(() => parseGithubSpec('https://example.com/owner/repo')).toThrow(/github\.com/)
    expect(() => parseGithubSpec('github:owner/repo#main;whoami')).toThrow(/safe npm or GitHub token/)
    expect(() => parseGithubSpec('github:owner/repo#main', true)).toThrow(/full GitHub commit/)
  })

  it('requires a DSH bundle or client surface', () => {
    expect(validatePluginManifest({ name: 'bundle', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      .toEqual({ packageName: 'bundle', bundlePatch: './cordis.patch.yml', client: false })
    expect(validatePluginManifest({ name: 'client-only', dsh: { client: { platform: 'web' } } }))
      .toEqual({ packageName: 'client-only', bundlePatch: null, client: true })
    expect(() => validatePluginManifest({ name: 'plain-library' })).toThrow(/neither dsh\.bundle/)
  })

  it('resolves npm metadata to an immutable version with integrity', async () => {
    const fetch = vi.fn(async () => json({
      name: 'dsh-example',
      version: '1.4.2',
      description: 'Example',
      repository: { url: 'git+https://github.com/example/dsh-example.git' },
      peerDependencies: {
        'dsh-companion': ' ^2.0.0 ',
        'Invalid Package': '^1.0.0',
        'empty-range': '   ',
        'wrong-type': 42,
      },
      dist: { integrity: 'sha512-YWJjZA==' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))

    await expect(inspectPluginSource('dsh-example', { fetch })).resolves.toMatchObject({
      sourceType: 'npm',
      installSpec: 'dsh-example@1.4.2',
      packageName: 'dsh-example',
      repository: 'github.com/example/dsh-example',
      integrity: 'sha512-YWJjZA==',
      peerDependencies: { 'dsh-companion': '^2.0.0' },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/dsh-example/latest',
      expect.objectContaining({ redirect: 'follow' }),
    )
  })

  it('resolves a GitHub ref to a full commit and validates that commit manifest', async () => {
    const sha = 'a'.repeat(40)
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/repos/example/plugin')) return json({ default_branch: 'main' })
      if (url.endsWith('/commits/main')) return json({ sha })
      if (url.includes('raw.githubusercontent.com')) {
        return json({
          name: 'github-plugin',
          peerDependencies: { 'github-companion': '^3.0.0' },
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })
      }
      return json({}, 404)
    })

    await expect(inspectPluginSource('github:example/plugin', { fetch })).resolves.toMatchObject({
      sourceType: 'github',
      packageName: 'github-plugin',
      installSpec: `github:example/plugin#${sha}`,
      commit: sha,
      peerDependencies: { 'github-companion': '^3.0.0' },
    })
  })
})
