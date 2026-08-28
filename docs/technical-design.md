# Technical Design

## Boundaries

The bundle mounts two Host entries:

1. `PluginSearchRuntime`, the provider registry (`ctx.pluginSearch`).
2. The manager Host plugin, which owns built-in providers, profile operations,
   model tools, and `/plugins`.

It also ships one browser client entry that registers a static, read-only
Plugin Marketplace help tab in `settings.plugins.tab`. The client has no Remote
dependency and exposes no management action. There is no management HTTP route.

## Request Flow

```text
natural language --------------------------+
                                            v
/plugins request -> Agent steering -> plugin_discover / plugin_manage
                                            |
                                            v
                                    PluginManager core
                          +-----------------+------------------+
                          |                                    |
                   PluginSearchRuntime                  Operation runtime
                          |                                    |
                built-in / external providers         official DSH CLI
                                                               |
                                          postcondition -> hot activation
                                                               |
                                                     restart fallback

Settings > Plugins > Plugin Marketplace
        |
        +-- localized Chat examples only (no Host call or mutation control)
```

## Compact Conversation Surface

`/plugins` deliberately forwards its unstructured text to the Agent. A direct
command parser would duplicate the model's language understanding and create a
second confirmation implementation.

Two model tools are sufficient:

- discovery is read-only and may run without confirmation;
- management separates planning from execution and also owns operation status
  and cancellation.

The tool descriptions instruct the model to show a plan and then use one of two
confirmation paths. `confirm` asks through the plugin-owned DSH choice UI and,
on an exact approval, executes in the same tool call. `execute` remains the
plain-chat path and requires a later affirmative user message. The conversation
adapter binds each token to the Agent Session and its latest `user/message` seq
at planning time. Same-turn and cross-session execution fail before the manager
can consume the token.

The plugin-owned question has a plan-derived stable id, visible plan detail,
fixed approve and decline labels, single-selection semantics, and DSH's
`plan-review` intent. The adapter accepts only one answer with that exact id,
the exact approve label, and no custom text. It never interprets results from a
generic, model-authored `ask_user_question` call as mutation authority.
Declines, malformed answers, provider errors, and cancellation leave a valid
token retriable. Expiry is checked both before opening UI and atomically by the
manager when approval returns, covering a plan that expires while the UI is
open.

## Source Resolution

The core recognizes only this closed union:

```ts
type PluginSource =
  | { kind: 'npm'; package: string; version?: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string }
```

npm metadata provides the exact version, integrity, manifest, and repository
identity. GitHub's API resolves a ref/default branch to a full commit; the raw
manifest at that commit is then validated. Execution receives only the
immutable normalized spec.

## Search Providers

Providers are trusted installed code but their result data remains untrusted.
Registration validates provider identity. Search:

- calls providers concurrently;
- passes one AbortSignal;
- isolates provider failures;
- normalizes typed sources;
- inspects candidates through the core source resolver;
- merges npm/GitHub aliases by canonical repository identity;
- returns provenance and rejected-provider diagnostics.

For an exact npm package-name query, the npm provider inserts that name as a
candidate when the registry search ranking omits it. This is not trusted as an
installation result: the same core registry metadata, integrity, manifest, and
DSH-surface inspection still runs before it can be returned.

The query parser also recognizes explicit GitHub owner forms and conservative
bare-owner hints. A typed owner intent reaches the GitHub provider, which uses
`user:<owner> topic:dsh-plugin`, verifies every returned `full_name` owner, and
marks exact matches structurally. Inferred bare hints fall back to the ordinary
keyword query when the owner search returns no repositories. Exact typed
matches sort before provider-local rank; local scores remain incomparable.

Search results expose the canonical repository owner, aggregate provider ids,
and bounded match reasons in addition to per-source provenance. The emitted
`github.com/owner/repo` identity is itself an accepted source, so it can flow
directly into `inspect`; `recommendedSource` is immutable and can flow directly
into `plan`. Owner-only identities fail inspection with guidance to use owner
search instead of falling through to npm validation.

No provider callback participates after discovery.

## Confirmation Plans

Plans live in memory for ten minutes. A single-mutation plan carries:

- operation and profile;
- package/source and immutable target where applicable;
- impact/restart expectations;
- creation/expiry timestamps;
- SHA-256 digest and a random one-use confirmation token.

Execution atomically consumes the token before starting an operation. Retrying
requires a new plan. Immediately before operation creation, the manager also
compares the planned dependency source with the current profile and refuses a
stale plan. This prevents confirmation replay, plan substitution, and mutation
after an out-of-band profile change.

An `install_many` plan contains an ordered, bounded list of the same immutable
install items under one digest and confirmation token. Nested plan data is
deeply frozen. Planning resolves every source before creating the plan, rejects
duplicate package identities, and reports required peer dependencies that are
absent from both the profile and the requested list. Peers marked optional in
`peerDependenciesMeta` are excluded. Missing peers are advisory: the manager
suggests their npm source but does not silently expand the confirmed mutation
scope.

## Package Mutations

The runner reuses the current DSH installation. When the current Node entry is
an existing file, it invokes `process.execPath <current-entry> plugin ...`;
otherwise it uses explicit `DSH_EXECUTABLE` or the `dsh` command. Arguments are
always an array. Windows shell fallback is limited to a bare `.cmd` executable.

Only one top-level mutation runs at once. Additional confirmed operations enter
a FIFO and retain `queued` status instead of failing busy. Plans are checked
again when they leave the queue so an intervening mutation cannot execute a
stale target. An `install_many` operation owns one queue slot and invokes child
installs serially, so child work never competes for the tracker. The batch stops
on the first child failure, retains earlier successes, and marks later children
skipped. Output is bounded and exposed as progress. Cancellation removes queued
work without starting it, or reaches the active child and prevents later
children from starting.

After add succeeds, the manager verifies the saved immutable dependency, the
installed package name and exact npm version, a declared DSH surface, and exact
bundle membership before reporting success. A failed check restores the saved
profile manifest and reports a failed operation.

Tracked operations have explicit restart-aware terminal states. A successful
mutation that needs a separately confirmed restart finishes as
`succeeded_restart_required` when the restarter is available, or
`waiting_for_manual_restart` when the deployment requires an operator action.
The mutation itself is complete in both cases; it is never left `running` while
waiting for restart.

## Enablement

DSH has Loader-entry enablement, not a native package-level boolean. The manager
derives package ownership from the package's bundle patch insert rows.

Disable appends manager-owned `{ id, disabled: true }` overrides to the profile
patch and records ownership under `.relay-plugin-manager/state.json`. Enable
removes only exact overrides still owned by that state. Existing user-authored
rows are never overwritten. HMR verification reads current Loader entries.

Disabling a plugin that supplies the backend or another capability used by the
executing conversation can interrupt that turn when Loader HMR disposes it.
Disable plans state this explicitly so continuity-sensitive operations can be
confirmed from another backend or Session.

Self and protected infrastructure ids/names cannot be disabled.

## Restart-Free Activation

For a new bundle, the manager may create a process-local Include subtree when
the bundle patch consists only of insert rows containing `id` and `name`.
Client-only packages receive a no-op Host shim so the client module can be
served. Complex patches, activation timeout, missing Include support, and
runtime failure produce a restart-required result.

Temporary hot inputs are deleted at manager startup. Durable bundle membership
remains owned by the profile manifest and becomes authoritative at next boot.

## Restart

Restart is never chained automatically after another operation. A confirmed
restart starts a detached helper which waits for the old process to exit,
replays the exact DSH invocation, and then terminates the old process.

Automatic restart is unavailable when explicitly disabled or when the running
process is detected as a systemd-owned main process. The user must then use the
deployment supervisor.
