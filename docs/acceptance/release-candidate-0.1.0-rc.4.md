# Release Candidate Acceptance - 0.1.0-rc.4

## Scope

This record validates the cumulative delivery of PRs #4, #5, and #6 plus the
A-031 cross-feature release flow. The candidate starts from main commit
`aa0330c6d7e9ddd5f4d579481e9e14b52b4e6ea7` and changes the package version to
`0.1.0-rc.4`.

## Environment

- Date: 2026-08-28 (Asia/Shanghai)
- Node.js: v25.5.0 locally; Node.js 22 and 24 in CI
- npm: 11.8.0
- pnpm: 11.19.0 locally; 11.7.0 in release CI
- DSH acceptance fixture: `@deepseek-ai/dsh@0.1.1-rc.2`
- npm dist-tag target: `next`

No LLM request or LLM credential was required. The repository secret scan had
no matches.

## Cross-Feature Acceptance

A-031 runs one scenario through the real DSH `ToolRuntime`, `AgentRegistry`,
`PluginSearchRuntime`, and `UserQuestionService`, with the production
`PluginManager` and a controlled official-CLI runner boundary.

The scenario passed all of these assertions:

1. Discovery emitted three immutable recommended sources in provider rank.
2. Those exact values entered one `install_many` plan without profile mutation.
3. The plan exposed the missing Workbench peer and its requesting plugin.
4. The plugin-owned question displayed all sources and peer preflight detail.
5. No runner call or profile mutation occurred while the UI answer was pending.
6. One exact approval started one parent operation.
7. Three exact `add --save-exact` calls ran serially with maximum concurrency one.
8. Parent and child operations completed successfully and the profile contained
   the three exact versions.
9. Approval replay did not reopen the question or start another runner call.

## Verification Results

- Typecheck: passed
- Vitest: 90 passed; 2 opt-in live tests skipped in the default suite
- Release metadata tests: 4 passed
- Build: passed
- Packed-package install through the official DSH CLI: passed
- npm production dependency audit: 0 vulnerabilities
- Credential scan: passed
- Simulated tag metadata: `v0.1.0-rc.4` -> `0.1.0-rc.4` on `next`
- Registry preflight: `0.1.0-rc.4` was not already published
- `npm publish --dry-run --tag next`: passed; 25 files, approximately 89.7 kB

The opt-in real-network suite also passed both tests. It discovered the six
owner repositories, resolved the Codex GitHub source to commit
`ef65b29dd52c92278a2717f19d2a8f056cefdfaa`, completed the npm/GitHub Codex
lifecycle, booted Web with HTTP 200, and batch-installed Codex, Files, and
Terminal through the published DSH CLI fixture.

## Release Decision

The candidate satisfies A-001 through A-031 and is approved for publication as
`0.1.0-rc.4` after its release PR and tag workflow pass on the final commit.
