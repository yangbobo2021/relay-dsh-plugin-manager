# Live Codex Plugin Acceptance - 2026-08-26

## Scope

Opt-in live-network acceptance of `relay-dsh-plugin-codex` through the plugin
manager implementation. The run used two fresh temporary `DSH_HOME` roots and
the immutable official DSH checkout. Both temporary roots were removed after
the run.

Command:

```sh
npm run acceptance:live:codex
```

## Environment

| Item | Value |
|---|---|
| Date/time zone | 2026-08-26, Asia/Shanghai |
| Node | `v25.5.0` |
| npm | `11.8.0` |
| pnpm | `11.19.0` |
| Official DSH commit | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Codex plugin repository commit | `56324ecd9f2df4c172af2967fb347517d0770270` |

The Codex plugin checkout was clean after acceptance. The official DSH checkout
retained its pre-existing untracked development symlink
`packages/core/tools/dsh-tools` (created 2026-08-25); the acceptance did not
create or modify it.

## Source Evidence

| Source | Resolved immutable value |
|---|---|
| npm | `relay-dsh-plugin-codex@0.1.2` |
| npm integrity | `sha512-UD3Ud3zTsxRY/0ZlLsAqbAopXb7fPY5zXjefMRWsAqG+wBaZMNSrYd5XpI453xBe8M/KdNFdae+Ha3HNI+aQ4w==` |
| GitHub | `github:yangbobo2021/relay-dsh-plugin-codex#56324ecd9f2df4c172af2967fb347517d0770270` |

The real search result merged npm and GitHub provenance into one candidate and
recommended the exact npm source. Initial execution exposed that npm Registry
ranking omitted the exact package from the bounded keyword result; PM-006 was
fixed so an exact valid npm package-name query remains a candidate and still
passes full core inspection.

## Lifecycle Evidence

| Scenario | Result |
|---|---|
| npm search and inspection | Passed; exact semver, SHA-512 integrity, repository, bundle patch |
| GitHub search and inspection | Passed; full 40-character commit and bundle patch |
| npm install through official DSH CLI | Passed; dependency, installed identity/version, DSH surface, and one bundle verified |
| Installed status | Passed; bundle enabled and restart required outside the booted process |
| `--dump-config` | Passed; `relay-codex-host` present |
| Real `dsh web --no-open --port 0` boot | Passed; readiness URL returned HTTP 200 |
| Disable | Passed; manager-owned `relay-codex-host` override persisted |
| Enable | Passed; only manager-owned override removed |
| Update | Passed; exact official add path and restart boundary verified |
| npm remove | Passed; dependency and bundle absent |
| Immutable GitHub install | Passed; exact commit dependency and bundle verified |
| GitHub remove | Passed; dependency and bundle absent |

The final successful RC boot URL used a random ephemeral port
(`http://127.0.0.1:52149`) and the process was terminated cleanly. No model
request, Codex conversation, or automatic DSH restart was performed in this
script; real conversation and Loader HMR evidence is recorded separately in
[`release-candidate-2026-08-26.md`](./release-candidate-2026-08-26.md).
