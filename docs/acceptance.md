# Delivery Acceptance

This matrix is the release contract. Tests name the relevant `PM-*` ids.

## Scenario Matrix

| Scenario | Requirement coverage | Automated evidence |
|---|---|---|
| A-001 `/plugins` without arguments submits one list request to the receiving Agent | PM-001, PM-002 | command unit/integration |
| A-002 `/plugins install X` and ordinary `install X` expose the same two model tools and management workflow | PM-001, PM-002 | command/tool integration |
| A-003 list an empty and populated profile with bundle, enablement, runtime, and restart fields | PM-003 | profile unit + manager integration |
| A-004 external search provider registers, returns results, disposes, times out, fails, and cancels without breaking siblings | PM-004, PM-005 | search-registry unit |
| A-005 npm and GitHub search results are inspected, exact npm package names survive ranking omission, invalid bundles are dropped, aliases deduplicated, and provenance retained | PM-005, PM-006, PM-008 | provider/search integration with fake network + live Codex acceptance |
| A-006 npm bare name resolves to exact semver/integrity; mutable or malformed npm specs cannot execute | PM-007, PM-008, PM-018 | source unit |
| A-007 GitHub URL/slug resolves to a full commit; non-GitHub URLs and unsafe refs are rejected | PM-007, PM-008, PM-018 | source unit |
| A-008 install plan performs no mutation, returns digest/token/expiry, binds the token to its Session, and rejects same-turn/cross-session execution so the original request is not confirmation | PM-009 | plan unit + tool integration |
| A-009 token is one-use, expires, cannot substitute another operation, rejects stale profile state, and execution creates one tracked operation | PM-009, PM-015 | plan/operation unit + manager integration |
| A-010 install invokes exact official argv, verifies dependency source, installed identity/version, DSH surface, and one bundle membership, then reports hot or restart-required activation | PM-010, PM-013, PM-017 | fake-CLI integration |
| A-011 failed install restores manifest residue and never reports installed | PM-017 | fake-CLI integration |
| A-012 update resolves an immutable newer source, invokes exact add argv, verifies installed spec, and supports rollback reporting | PM-009, PM-010, PM-017 | fake-CLI integration |
| A-013 remove invokes exact official argv, verifies absence, live-disposes when possible, and reconciles half-removal | PM-011, PM-013, PM-017 | fake-CLI integration |
| A-014 disable warns about active-conversation interruption, writes only manager-owned patch rows, HMR-verifies state, survives reload, and enable removes only owned rows | PM-012, PM-014 | plan + profile/loader integration + real DSH walkthrough |
| A-015 mixed, unknown, user-patch conflict, self-disable, and protected-infrastructure disable are refused or reported accurately | PM-012, PM-014 | enablement unit/integration |
| A-016 simple insert bundle hot-mounts; complex/config patch, unavailable Include, timeout, and thrown activation require restart | PM-013 | hot-runtime unit/integration |
| A-017 operation progress is bounded, concurrently confirmed mutations run in FIFO order with one active runner, queued cancellation never starts its runner, active cancellation reaches the runner, and terminal status is retained | PM-015 | operation unit + manager integration |
| A-018 restart requires a separate plan, is refused under supervisor/disabled config, and schedules exact invocation otherwise | PM-016 | restart unit |
| A-019 package exposes only a read-only help client entry, no management HTTP route, and registers exactly one command/two tools | PM-001, PM-002, PM-019, PM-021 | package/loader integration |
| A-020 packed tarball installs through official DSH CLI into a clean profile and contributes both Host rows without modifying DSH | PM-020 | local checkout E2E + CI against the locked published DSH runtime fixture |
| A-021 optional live-network acceptance discovers the real Codex plugin through npm/GitHub, installs npm and immutable GitHub sources in isolated DSH homes, boots the npm-installed Web profile, exercises enable/disable/update, and removes both | PM-003-PM-017 | `npm run acceptance:live:codex` |
| A-022 a real DSH Web Session exposes both tools, serves slash-command and natural-language search, rejects same-turn confirmation, executes later confirmation, and observes Loader HMR without restarting DSH | PM-001, PM-002, PM-009, PM-012, PM-014 | release-candidate walkthrough with real Codex backend |
| A-023 Settings > Plugins opens on one localized recommended-plugins tab that gives each recommended plugin a self-contained card headed by its exact npm package name, carrying its purpose, prerequisite, a complete install message repeating that package name, and its post-install check, with tab-level copy claiming nothing about a specific plugin; the page has no action control, Host call, or Remote dependency | PM-019, PM-021 | client registration + server-rendered component unit tests + packed client-bundle E2E |
| A-024 three immutable plugin sources produce one deeply immutable plan and token, execute serially after one confirmation, expose per-child outcomes, stop/skip after failure, cancel without starting later children, and reject duplicates, invalid bounds, or aggregate stale state before mutation | PM-009, PM-010, PM-015, PM-017, PM-018 | plan/operation unit + conversation tool + fake-CLI manager integration |
| A-025 multi-install planning deduplicates missing peer dependencies, excludes optional peers and peers already installed or requested, suggests but never silently installs companions, and successful operations terminate as `succeeded`, `succeeded_restart_required`, or `waiting_for_manual_restart` according to activation and restart availability | PM-013, PM-015, PM-016, PM-022 | source/plan unit + manager integration + opt-in real Codex/Files/Terminal DSH CLI lifecycle |
| A-026 a valid Session-bound plan opens one plugin-owned DSH `plan-review` question; no mutation starts before an answer, and the exact single approve answer executes once without a typed chat message | PM-009, PM-023 | conversation state-machine unit + real UserQuestionService integration |
| A-027 decline, malformed/unrelated/custom answers, provider failure/cancellation, cross-session use, pre-prompt expiry, expiry while waiting, and approval replay never cause an unauthorized mutation; a still-valid rejected plan remains retriable, while later-message `execute` remains supported | PM-009, PM-023 | negative confirmation matrix + manager expiry/replay integration |
| A-028 explicit, natural-language, and conservative bare GitHub owner queries issue an exact owner-qualified search, verify ownership, rank inspected owner plugins ahead of unrelated rows, expose owner/provider/reason metadata, and fall back from an empty inferred hint to keyword search | PM-005, PM-006, PM-024 | query/provider unit + mixed-provider search integration + opt-in live owner search |
| A-029 `github.com/owner/repo`, canonical HTTPS, and `github:owner/repo` inspect to the same immutable plugin; emitted repository identities round-trip into inspect and recommended sources round-trip into install planning | PM-007, PM-008, PM-024 | source unit + manager integration + opt-in live schemeless inspection |
| A-030 owner-only inspect forms return actionable search guidance while malformed, unsafe, and non-GitHub inputs remain rejected without weakening source validation | PM-018, PM-024 | source/manager negative unit |
| A-031 search results feed one immutable multi-install plan through the real DSH tool and user-question registries; no mutation starts before one exact UI approval, then child installs execute serially and approval replay is rejected | PM-002, PM-005, PM-009, PM-010, PM-015, PM-023, PM-024 | combined host/tool/search/question/manager integration |
| A-032 The default formal Registry searches at least 3,000 source records for Chinese task text, English task text, exact plugin names and an honest empty result; every returned source is locally inspected to an immutable npm version or GitHub commit, while Registry authority remains source-only, untrusted, non-recommending and non-approving | PM-005, PM-006, PM-025 | provider/unit/host integration tests plus `npm run acceptance:live:registry` |
| A-033 Search defaults to a complete twenty-candidate result page, assigns stable one-based display ranks after merge and deduplication, and tells the Agent to exclude clearly unrelated purposes while surfacing every remaining possibly relevant candidate without silent fixed-count truncation | PM-005, PM-026 | search orchestration and conversation-tool contract unit tests plus Agent answer acceptance |

## Test Layers

### Unit

Pure parsing, source resolution, search registry, deduplication, plans, profile
projection, patch ownership, hot-patch classification, operation state,
restart policy, client-tab registration, locale dictionaries, and static help
markup. Network, clock, random values, process spawning, and Loader entries are
injected fakes.

### Integration

Use temporary profiles and an in-process fake official CLI runner that performs
the same manifest/bundle changes DSH owns. Exercise real manager orchestration,
postconditions, rollback, operation polling, cancellation, Loader state, actual
DSH command/tool/user-question registries, controlled confirmation, and
model-tool execution.

### E2E

Build and pack the package, install the tarball through an official DSH CLI
into a new temporary `web` profile, verify and execute the packed client bundle,
and run `--dump-config`. Local acceptance
uses the immutable official checkout; CI and release acceptance use the
published DSH version locked under `test/fixtures/dsh-runtime`. Assert package
dependency, bundle membership, search-service row, manager row, Marketplace tab
registration, localized help rendering, and unchanged upstream Git status when
a checkout is present.

### Optional release acceptance

Real npm/GitHub requests are opt-in because they are network-dependent. They
use isolated temporary DSH homes and pinned public fixtures. The release record
must capture DSH version/commit, Node, pnpm, exact npm version, exact GitHub
commit, and sanitized output.

The current evidence record is
[`live-codex-2026-08-26.md`](./live-codex-2026-08-26.md). The real
conversation and Loader record is
[`release-candidate-2026-08-26.md`](./release-candidate-2026-08-26.md). GitHub
owner discovery and schemeless repository round-trip evidence is recorded in
[`live-owner-discovery-2026-08-28.md`](./acceptance/live-owner-discovery-2026-08-28.md).
The cumulative `0.1.0-rc.4` release decision and A-031 evidence are recorded in
[`release-candidate-0.1.0-rc.4.md`](./acceptance/release-candidate-0.1.0-rc.4.md).

## Review Gates

After each implementation slice:

1. Compare changed behavior to every affected `PM-*` row.
2. Confirm each positive path has mutation/postcondition assertions.
3. Confirm rejection, cancellation, partial failure, and retry behavior.
4. Run the smallest affected suite and inspect that it actually reaches the
   intended boundary rather than only testing a mock's return value.
5. Update this matrix before accepting behavior that was not previously named.

Release requires typecheck/build, all unit/integration tests, local package E2E,
and a final SPEC-code-test traceability review.
