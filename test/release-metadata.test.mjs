import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { releaseMetadata } from '../scripts/release-metadata.mjs'

test('stable release tags publish to latest', () => {
  assert.deepEqual(releaseMetadata('v0.1.0', '0.1.0'), {
    version: '0.1.0',
    npmTag: 'latest',
  })
})

test('prerelease tags publish to next', () => {
  assert.deepEqual(releaseMetadata('v0.2.0-rc.1', '0.2.0-rc.1'), {
    version: '0.2.0-rc.1',
    npmTag: 'next',
  })
})

test('release tags must exactly match the package version', () => {
  assert.throws(
    () => releaseMetadata('v0.2.0', '0.1.0'),
    /must exactly match v0\.1\.0/,
  )
})

test('release workflow guards and verifies npm publication', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /tags:\s*\n\s*- ['"]v\*['"]/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /node scripts\/release-metadata\.mjs/)
  assert.match(workflow, /git merge-base --is-ancestor/)
  assert.match(workflow, /npm publish --provenance --access public --tag/)
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/)
  assert.match(workflow, /Verify the published dist-tag/)
  assert.match(workflow, /npm view "\$\{package_name\}@\$\{npm_tag\}" version/)
})
