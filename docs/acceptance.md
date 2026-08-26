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
| A-017 operation progress is bounded, a concurrent mutation is refused, cancellation reaches the runner, and terminal status is retained | PM-015 | operation integration |
| A-018 restart requires a separate plan, is refused under supervisor/disabled config, and schedules exact invocation otherwise | PM-016 | restart unit |
| A-019 package exposes no client entry or management HTTP route and registers exactly one command/two tools | PM-001, PM-002, PM-019 | package/loader integration |
| A-020 packed tarball installs through official DSH CLI into a clean profile and contributes both Host rows without modifying DSH | PM-020 | local package E2E |
| A-021 optional live-network acceptance discovers the real Codex plugin through npm/GitHub, installs npm and immutable GitHub sources in isolated DSH homes, boots the npm-installed Web profile, exercises enable/disable/update, and removes both | PM-003-PM-017 | `npm run acceptance:live:codex` |
| A-022 a real DSH Web Session exposes both tools, serves slash-command and natural-language search, rejects same-turn confirmation, executes later confirmation, and observes Loader HMR without restarting DSH | PM-001, PM-002, PM-009, PM-012, PM-014 | release-candidate walkthrough with real Codex backend |

## Test Layers

### Unit

Pure parsing, source resolution, search registry, deduplication, plans, profile
projection, patch ownership, hot-patch classification, operation state, and
restart policy. Network, clock, random values, process spawning, and Loader
entries are injected fakes.

### Integration

Use temporary profiles and an in-process fake official CLI runner that performs
the same manifest/bundle changes DSH owns. Exercise real manager orchestration,
postconditions, rollback, operation polling, cancellation, Loader state, actual
DSH command/tool registries, and model-tool execution.

### E2E

Build and pack the package, install the tarball through the repository's
immutable official DSH checkout into a new temporary `web` profile, and run
`--dump-config`. Assert package dependency, bundle membership, search-service
row, manager row, and an unchanged upstream Git status.

### Optional release acceptance

Real npm/GitHub requests are opt-in because they are network-dependent. They
use isolated temporary DSH homes and pinned public fixtures. The release record
must capture DSH version/commit, Node, pnpm, exact npm version, exact GitHub
commit, and sanitized output.

The current evidence record is
[`live-codex-2026-08-26.md`](./live-codex-2026-08-26.md). The real
conversation and Loader record is
[`release-candidate-2026-08-26.md`](./release-candidate-2026-08-26.md).

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
