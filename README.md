# Relay DSH Plugin Manager

[![npm](https://img.shields.io/npm/v/relay-dsh-plugin-manager?label=npm)](https://www.npmjs.com/package/relay-dsh-plugin-manager)
[![CI](https://github.com/yangbobo2021/relay-dsh-plugin-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/yangbobo2021/relay-dsh-plugin-manager/actions/workflows/ci.yml)
[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4c1)](https://github.com/topics/dsh-plugin)

Conversation-first plugin discovery and lifecycle management for the DeepSeek
Harness `web` profile. The package has no settings UI and registers no public
management HTTP routes.

## Quick Start

Install with the DSH instance that will run the profile, then restart DSH once:

```sh
dsh plugin --profile web add --save-exact relay-dsh-plugin-manager@0.1.0-rc.2
```

Search and manage plugins from an ordinary conversation:

```text
/plugins 找一个能连接飞书的插件
/plugins 安装 example-dsh-plugin
```

## Conversation Surface

The bundle contributes one human command and two model tools:

- `/plugins [request]` sends the request to the current Agent;
- `plugin_discover` lists, searches, inspects, and reports status;
- `plugin_manage` plans, executes, polls, and cancels mutations.

Ordinary natural-language requests use the same tools. Every install, update,
remove, enable, disable, or restart is a two-stage operation: the Agent first
shows a plan, then uses its one-use token only after a later explicit user
confirmation. The token is bound to that DSH conversation, and same-turn or
cross-conversation execution is rejected in code.

More examples:

```text
卸载 example-dsh-plugin
列出当前插件以及是否需要重启
```

The official DSH command adds the package to profile dependencies and mounts
both bundle rows. Restart DSH after the manager itself is first installed.

## Behavior

- npm sources resolve to an exact version and SHA-512 registry integrity.
- GitHub sources resolve to a full commit before execution.
- Package mutations call the current official DSH CLI with argv arrays.
- New simple insert-only bundles may activate without restart; complex bundles
  and updates report `restartRequired`.
- Enable/disable owns only exact Loader override rows written by this manager.
- Disabling a plugin used by the current conversation can interrupt that turn;
  use another backend or Session when continuity matters.
- Mutations are serialized, cancellable, and retain pollable terminal status.
- Automatic restart is a separate confirmed operation and is disabled for a
  detected systemd main process unless explicitly configured.

Set `allowRestart: false` on the `relay-plugin-manager-host` bundle row to
disable automatic restart in other deployments as well.

## Search Extensions

Installed Host plugins can inject `pluginSearch`, require `apiVersion === 1`,
and register a provider:

```ts
export const inject = ['pluginSearch']

export function apply(ctx) {
  ctx.pluginSearch.register({
    id: 'internal-catalog',
    async search({ query, maxResults, signal }) {
      return lookupCatalog(query, { maxResults, signal })
    },
  })
}
```

Providers return npm/GitHub candidates only. Core inspection, immutable source
resolution, confirmation, installation, rollback, and activation are not
extension points.

## Verification

```sh
npm ci --ignore-scripts
npm run verify
npm run acceptance:live:codex
npm run release:dry-run
```

`verify` runs type checking, unit/integration tests, the production build, and
a local package E2E that installs the tarball through the immutable official
DSH checkout. The live command additionally uses the public npm/GitHub services
and the real `relay-dsh-plugin-codex` package. The RC dry run uses npm's
`next` dist-tag. See [SPEC.md](./SPEC.md) and
[docs/acceptance.md](./docs/acceptance.md) for the release contract and
traceability matrix. The current real-session release record is
[docs/acceptance/release-candidate-2026-08-26.md](./docs/acceptance/release-candidate-2026-08-26.md).
Tag-triggered npm publication is defined in
[docs/releasing.md](./docs/releasing.md).

## Repository Boundary

This is an independently installable package. It imports no Relay parent or
KeySync implementation code. The local KeySync prototype handoff was used as
reference material and is intentionally excluded from both git and the npm
package.
