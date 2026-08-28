# Live GitHub Owner Discovery Acceptance - 2026-08-28

## Scope

This record validates Issue #3 against the real npm and GitHub services and a
published DSH runtime. It covers GitHub-owner discovery, schemeless repository
inspection, immutable-source planning, the complete Codex plugin lifecycle, and
the existing three-plugin batch flow.

## Environment

- Date: 2026-08-28 (Asia/Shanghai)
- Node.js: v25.5.0
- npm: 11.8.0
- pnpm: 11.19.0
- DSH: `@deepseek-ai/dsh@0.1.1-rc.2`
- Plugin manager base commit: `8d78cd267bd12cea246c97d36a233098d5ceb5ed`

The test used an isolated temporary DSH home. It did not make an LLM request,
require an LLM credential, or persist credentials in repository artifacts.

## Command

```sh
DSH_CLI_PATH=test/fixtures/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js \
  npm run acceptance:live:codex
```

## Observed Results

The live suite passed both tests in 27.8 seconds.

The explicit owner query `owner:yangbobo2021` returned and prioritized all six
owner-matching DSH repositories before unrelated results:

1. `yangbobo2021/relay-dsh-plugin-codex`
2. `yangbobo2021/relay-dsh-plugin-claude`
3. `yangbobo2021/relay-dsh-plugin-files`
4. `yangbobo2021/relay-dsh-plugin-workbench`
5. `yangbobo2021/relay-dsh-plugin-manager`
6. `yangbobo2021/relay-dsh-plugin-terminal`

Each prioritized result exposed its repository owner, contributing provider,
and exact-owner match reason. Core inspection independently verified the owner
before the result received exact-match priority.

The schemeless identity
`github.com/yangbobo2021/relay-dsh-plugin-codex` inspected successfully and
resolved to immutable commit
`ef65b29dd52c92278a2717f19d2a8f056cefdfaa`. The emitted repository identity
and immutable recommended source were accepted directly by the next inspect and
plan actions.

The existing live lifecycle also passed for Codex from npm and GitHub,
including install, enable, disable, update, uninstall, operation polling, Loader
state, and web boot with HTTP 200. The live batch flow passed for Codex, Files,
and Terminal. The npm Codex fixture resolved to version `0.1.2`.

## Acceptance Conclusion

The live evidence satisfies the network-dependent portions of A-028 and A-029;
the automated negative suite covers A-030. Owner-oriented discovery works
without shell or direct-API workflow repair, result identities round-trip
through the plugin tools, and the pre-existing lifecycle remains operational.
