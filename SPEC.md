# Relay DSH Plugin Manager Specification

Status: implementation contract
Target package: `relay-dsh-plugin-manager`
Target profile: the running `web` profile

## Product Contract

Relay DSH Plugin Manager is a conversation-first, independently installable
DeepSeek Harness bundle. It discovers and manages DSH profile plugins through
conversation, without management controls or public management HTTP routes.

The package contributes a read-only Plugin Marketplace help tab under
Settings > Plugins. That tab explains how to search, install, remove, and list
plugins from Chat; it does not call the Host or mutate plugin state.

The user may enter `/plugins <request>` or describe the same request in ordinary
conversation. Both paths use the same model-facing tools and Host management
service.

## Requirements

| ID | Requirement |
|---|---|
| PM-001 | Register exactly one human command, `/plugins [request]`. It submits the request to the receiving Agent; it does not implement a second command-only management path. |
| PM-002 | Keep the model surface compact: one discovery tool and one management tool. Natural-language and slash-command requests use these tools. |
| PM-003 | List profile dependencies with installed source, bundle membership, package-level enablement, runtime phase, and pending-restart state. |
| PM-004 | Provide a versioned `ctx.pluginSearch` registry. Other installed plugins may register abortable search providers. Providers discover candidates only and cannot install or mutate the profile. |
| PM-005 | Search all registered providers concurrently with bounded results, timeout/cancellation, provenance, provider-error isolation, and repository/package-identity deduplication. |
| PM-006 | Ship npm and GitHub search providers. Preserve a syntactically valid exact npm package-name query even when npm search ranking omits it. Search results are inspected before being reported as installable DSH plugins. |
| PM-007 | Accept only core-owned npm and GitHub install-source types. Resolve npm to an exact semantic version with registry integrity and GitHub to a full 40-character commit. |
| PM-008 | Inspect the resolved package manifest and require a valid package name plus a DSH surface (`dsh.bundle.patch` or `dsh.client`). Search providers cannot bypass this validation. |
| PM-009 | Every install, multi-install, remove, update, enable, disable, or restart starts with an immutable plan. A later execute call requires the unexpired, one-use confirmation token returned by that plan. The token is bound to the planning DSH Session and cannot execute until that Session contains a newer user message; the original request is mechanically not confirmation. Execution also refuses a stale plan when any target profile dependency changed after planning. |
| PM-010 | Install and update through argv-only invocation of the currently running DSH CLI: `dsh plugin --profile web add --save-exact <immutable-source>`. Never build a shell command string. |
| PM-011 | Remove through argv-only `dsh plugin --profile web remove <package>`. Verify dependency and bundle postconditions and reconcile a half-removed profile conservatively. |
| PM-012 | Enable and disable are package-level projections over owned Cordis Loader entries. Persist manager-owned `disabled` overrides in the profile patch, report `mixed` or `unknown` when ownership is not safely reducible, and never disable the manager itself or protected DSH infrastructure. A disable plan warns that conversations using the target plugin may be interrupted. |
| PM-013 | Attempt restart-free activation for newly installed client-only packages and bundles whose patches contain only plain insert rows. Attempt live disposal for removals. Otherwise report `restartRequired` with a concrete reason. |
| PM-014 | Enable/disable changes use Loader HMR and normally require no restart. A failed or unverifiable live transition reports pending restart rather than claiming success. |
| PM-015 | Mutations run as tracked FIFO operations with stable ids, progress snapshots, explicit terminal exit state, cooperative cancellation, and one active top-level mutation at a time; additional confirmed operations remain queued rather than failing busy. A multi-install is one top-level operation whose child installs run serially, stop on the first failure, and retain succeeded, failed, skipped, or cancelled child outcomes. Successful mutations that still need restart terminate as `succeeded_restart_required` when a separately confirmed automatic restart is available, or `waiting_for_manual_restart` when it is not. |
| PM-016 | Restart is a separately planned operation. When allowed, relaunch the exact current DSH entry/argv/environment through a detached helper, then stop the old process. Refuse automatic restart under a detected service supervisor or explicit disable setting. |
| PM-017 | Snapshot the profile manifest before package mutations. Restore failed install/update manifest residue; detect and reconcile a remove that deleted package files before pnpm failed. Never report success before dependency source, installed package identity/version, DSH surface, and bundle-membership postconditions pass. |
| PM-018 | Reject unsafe source tokens, flags, whitespace/control characters, shell metacharacters, unsupported URL hosts, ambiguous package names, and mutable execution sources. Build scripts remain governed by pnpm/DSH and are never silently authorized. |
| PM-019 | Expose no public plugin-management HTTP routes and impose no client-address, Origin, CORS, or loopback policy. The callable surface is the in-process DSH command/tool plane. |
| PM-020 | Remain independently installable. Do not import Relay parent implementation code or KeySync implementation code. Runtime interactions use DSH/Cordis public services and the official CLI. |
| PM-021 | Contribute one localized, read-only `marketplace` tab to `settings.plugins.tab`. It briefly explains conversation-based discovery and lifecycle management, includes representative search/install/remove/list prompts, and states that mutations wait for confirmation. It exposes no management control, Remote call, or additional Host service. |
| PM-022 | Preserve required manifest peer-dependency metadata during source inspection while respecting `peerDependenciesMeta.optional`. A multi-install plan reports required peers absent from both the current profile and the requested set, deduplicated with their ranges, dependents, and suggested npm source. Planning never silently adds an unrequested companion plugin. |

## Command Grammar

Only `/plugins` is registered.

- `/plugins` submits a request to list installed plugins.
- `/plugins <text>` submits `<text>` as a plugin-management request.
- The command does not parse install/remove synonyms. The Agent interprets the
  same natural language that it would receive without the slash command.

This keeps command discovery and persistent prompt cost small while avoiding
behavior drift between direct commands and conversation.

## Model Tool Contract

### `plugin_discover`

Read-only actions: `list`, `search`, `inspect`, `status`.

### `plugin_manage`

State-changing workflow actions: `plan`, `execute`, `status`, `cancel`.
`plan` carries one operation from `install`, `remove`, `update`, `enable`,
`disable`, `restart`, or `install_many`. `install_many` accepts a bounded,
non-empty `sources` array and returns one ordered aggregate plan. `execute`
accepts only a confirmation token.

## Search Extension Contract

A search provider registers a stable id and an abortable `search()` function.
It returns typed npm/GitHub candidates with provenance and optional local score.
The manager owns inspection, immutable resolution, deduplication, ranking,
confirmation, installation, rollback, activation, and restart.

Provider scores are not globally comparable. The manager uses them only within
one provider before deterministic cross-provider ordering.

## Explicit Non-Goals

- Settings controls, dashboard, or any other second management workflow. The
  read-only Plugin Marketplace help tab is explicitly in scope.
- Public management REST/HTTP endpoints.
- Provider-defined installers, shell commands, or arbitrary pnpm arguments.
- Arbitrary tarball, filesystem, SSH Git, or non-GitHub Git installation in the
  first release.
- Automatic mutation based only on a search query.
- Silent installation of peer or companion plugins that the user did not request.
- Automatic restart as part of install/update/remove.
- Managing profiles other than the running `web` profile in the first release.
