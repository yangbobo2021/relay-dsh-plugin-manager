# Technical Design

## Boundaries

The bundle mounts two Host entries:

1. `PluginSearchRuntime`, the provider registry (`ctx.pluginSearch`).
2. The manager Host plugin, which owns built-in providers, profile operations,
   model tools, and `/plugins`.

There is no browser client entry and no management HTTP route.

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
```

## Compact Conversation Surface

`/plugins` deliberately forwards its unstructured text to the Agent. A direct
command parser would duplicate the model's language understanding and create a
second confirmation implementation.

Two model tools are sufficient:

- discovery is read-only and may run without confirmation;
- management separates planning from execution and also owns operation status
  and cancellation.

The tool descriptions instruct the model to show a plan and wait for a later
affirmative user message before calling `execute`. The conversation adapter
also binds each token to the Agent Session and its latest `user/message` seq at
planning time. Same-turn and cross-session execution fail before the manager
can consume the token.

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

No provider callback participates after discovery.

## Confirmation Plans

Plans live in memory for ten minutes. Each carries:

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

## Package Mutations

The runner reuses the current DSH installation. When the current Node entry is
an existing file, it invokes `process.execPath <current-entry> plugin ...`;
otherwise it uses explicit `DSH_EXECUTABLE` or the `dsh` command. Arguments are
always an array. Windows shell fallback is limited to a bare `.cmd` executable.

Only one mutation runs at once. Output is bounded and exposed as progress.
Cancellation sends SIGTERM and later SIGKILL if needed.

After add succeeds, the manager verifies the saved immutable dependency, the
installed package name and exact npm version, a declared DSH surface, and exact
bundle membership before reporting success. A failed check restores the saved
profile manifest and reports a failed operation.

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
