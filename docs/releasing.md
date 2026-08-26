# Release Contract

## Version And Tag

- Commit the intended version in both `package.json` and
  `package-lock.json`.
- A release tag must be exactly `v<package version>`.
- Stable versions publish to npm's `latest` dist-tag.
- SemVer prereleases publish to `next`.
- The tagged commit must be reachable from `main`.

`scripts/release-metadata.mjs` is the executable source of truth.

## Publication Gates

The tag workflow installs dependencies without dependency lifecycle scripts,
validates the tag, verifies against the official published DSH CLI locked in
`test/fixtures/dsh-runtime`, runs the complete test/build/package acceptance
chain, audits production dependencies, inspects the tarball, refuses to
republish an existing version, and verifies the resulting npm dist-tag.

## First Publication Bootstrap

The first publication of `0.1.0-rc.1` used a short-lived granular npm token
stored as the repository's `NPM_TOKEN` Actions secret. The token allowed
publishing this public package and satisfied the npm account's 2FA policy.

After the first version exists, configure its npm Trusted Publisher:

- provider: GitHub Actions
- organization or user: `yangbobo2021`
- repository: `relay-dsh-plugin-manager`
- workflow filename: `release.yml`
- allowed action: `npm publish`

The publisher is now configured. The bootstrap npm token and `NPM_TOKEN`
repository secret have been removed. The release workflow grants
`id-token: write`, uses an OIDC-capable npm CLI, and must not reference a
static npm credential.

## Release

```bash
git push origin main
git push origin v<version>
```

Do not move or reuse a published version tag. npm versions are immutable.
