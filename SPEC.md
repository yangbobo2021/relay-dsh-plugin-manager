# Relay DSH Plugin Manager Specification

Status: implementation contract
Target package: `relay-dsh-plugin-manager`
Target profile: the running `web` profile

## Product Contract

Relay DSH Plugin Manager is a conversation-first, independently installable
DeepSeek Harness bundle. It discovers and manages DSH profile plugins through
conversation, without management controls or public management HTTP routes.

The package contributes a read-only recommended-plugins tab under
Settings > Plugins. That tab gives each recommended plugin one self-contained
card headed by its npm package name, carrying its purpose, prerequisite, the
complete Chat message that installs it, and the check that confirms it worked.
It then points at Chat for installing, reviewing, or removing any other plugin;
it does not call the Host or mutate plugin state.

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
| PM-005 | Search all registered providers concurrently with bounded results, timeout/cancellation, provenance, provider-error isolation, and repository/package-identity deduplication. Exact typed intent matches sort before unrelated provider-local ranks. Results expose repository owner, aggregate providers, and bounded match reasons. |
| PM-006 | Ship npm and GitHub search providers. Preserve a syntactically valid exact npm package-name query even when npm search ranking omits it. Support explicit GitHub owner queries and conservative inferred bare-owner hints; inferred hints with no owned DSH repositories fall back to ordinary GitHub keyword search. Search results are inspected before being reported as installable DSH plugins. |
| PM-007 | Accept only core-owned npm and GitHub install-source types. GitHub repositories accept `github:owner/repo`, `https://github.com/owner/repo`, and the emitted identity `github.com/owner/repo`. Resolve npm to an exact semantic version with registry integrity and GitHub to a full 40-character commit. |
| PM-008 | Inspect the resolved package manifest and require a valid package name plus a DSH surface (`dsh.bundle.patch` or `dsh.client`). Search providers cannot bypass this validation. |
| PM-009 | Every install, multi-install, remove, update, enable, disable, or restart starts with an immutable plan and an unexpired, one-use confirmation token bound to the planning DSH Session. A plain `execute` call requires a newer user message in that Session, so the original request is mechanically not confirmation. A `confirm` call may instead ask the user through the controlled UI flow defined by PM-023. Execution also refuses a stale plan when any target profile dependency changed after planning. |
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
| PM-021 | Contribute one localized, read-only `marketplace` tab to `settings.plugins.tab`, sorted ahead of the Host's own tabs so Settings > Plugins opens on it. Each recommended plugin owns one self-contained card: its exact npm package name as the heading, its purpose, its prerequisite, one complete Chat message that installs it by that exact package name, and its post-install check. Tab-level copy claims nothing about a specific plugin and points at Chat for installing, reviewing, or removing any other plugin. It exposes no management control, Remote call, or additional Host service. |
| PM-022 | Preserve required manifest peer-dependency metadata during source inspection while respecting `peerDependenciesMeta.optional`. A multi-install plan reports required peers absent from both the current profile and the requested set, deduplicated with their ranges, dependents, and suggested npm source. Planning never silently adds an unrequested companion plugin. |
| PM-023 | `plugin_manage confirm` owns its DSH question: it validates the token, expiry, and exact Session before asking; supplies a stable plan-specific id, visible plan detail, exact approve/decline options, and `plan-review` intent; and executes in that same tool call only for the exact single approve answer. Declines, malformed or unrelated answers, provider failure/cancellation, and cross-session attempts do not execute or consume a still-valid plan. Generic model-authored question results are never mutation authority. |
| PM-024 | GitHub owner discovery recognizes `owner:<name>`, owner-only GitHub identities, `<name> DSH plugins`, and conservative bare identifiers containing digits. It sends a typed owner intent to providers, uses GitHub's exact owner qualifier, case-insensitively verifies returned ownership, and ranks verified owner matches first. Owner-only `inspect` fails with an actionable error directing callers to search. Every emitted repository identity is accepted by `inspect`; every recommended immutable source is accepted by `plan`. |
| PM-025 | Register a read-only DSH Registry provider against `https://dsh-plugins.tech` by default, with an explicit `registryUrl: false` opt-out and HTTPS-only configuration override. Send only the task query, inferred Chinese/English locale and result limit; accept only source-level untrusted DiscoveryEntry records, convert their npm/GitHub descriptors into core-owned source types, and submit them to the same mandatory local inspection used by all providers. Registry responses cannot supply exact versions, approval, plans, installers, or profile state, and provider failure remains isolated. |
| PM-026 | Return search candidates as one explicit, one-based relevance-ranked result page with a default and maximum size of 20. The model-facing contract requires the Agent to preserve rank order, surface every possibly relevant returned candidate, exclude candidates whose purpose is clearly unrelated, and MUST NOT silently reduce the remaining page to a fixed top-N. Ranking remains distinct from compatibility, security, or installation approval. |

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

`search` accepts capability text or GitHub owner forms such as
`owner:yangbobo2021`. `inspect` accepts npm sources and all three GitHub
repository forms from PM-007. An owner without a repository belongs to
`search`, not `inspect`. Search defaults to a twenty-candidate ranked page. Each
candidate carries its explicit display rank; the Agent presents all possibly
relevant returned candidates in that order instead of silently selecting an
arbitrary top five.

### `plugin_manage`

State-changing workflow actions: `plan`, `confirm`, `execute`, `status`, `cancel`.
`plan` carries one operation from `install`, `remove`, `update`, `enable`,
`disable`, `restart`, or `install_many`. `install_many` accepts a bounded,
non-empty `sources` array and returns one ordered aggregate plan. `confirm`
accepts the token and owns the DSH choice UI plus exact-answer validation.
`execute` accepts the token after a later explicit chat message. The Agent must
not wrap a plugin plan in the generic `ask_user_question` tool.

## Search Extension Contract

A search provider registers a stable id and an abortable `search()` function.
It returns typed npm/GitHub candidates with provenance and optional local score.
The manager owns inspection, immutable resolution, deduplication, ranking,
confirmation, installation, rollback, activation, and restart.

Provider scores are not globally comparable. The manager uses them only within
one provider before deterministic cross-provider ordering.

The `dsh-registry` provider defaults to `https://dsh-plugins.tech`. Plugin
configuration `registryUrl` or environment variable `DSH_PLUGIN_REGISTRY_URL`
may override that origin for controlled deployment, while `registryUrl: false`
disables it explicitly. Non-local overrides require HTTPS. The provider transmits
no Profile, installed inventory, path, credential, or conversation transcript.

## Explicit Non-Goals

- Settings controls, dashboard, or any other second management workflow. The
  read-only recommended-plugins help tab is explicitly in scope.
- Public management REST/HTTP endpoints.
- Provider-defined installers, shell commands, or arbitrary pnpm arguments.
- Arbitrary tarball, filesystem, SSH Git, or non-GitHub Git installation in the
  first release.
- Automatic mutation based only on a search query.
- Silent installation of peer or companion plugins that the user did not request.
- Automatic restart as part of install/update/remove.
- Managing profiles other than the running `web` profile in the first release.
