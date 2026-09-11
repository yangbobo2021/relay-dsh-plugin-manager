# Live DSH Task-Solution Acceptance — 2026-09-11

This record captures A-038: the task-solution workflow running through a real
DSH Web Session, rather than a direct manager or model-only harness.

## Frozen inputs

- Candidate: `relay-dsh-plugin-manager@0.2.6`, packed and installed into a
  disposable DSH Profile.
- DSH upstream commit: `76fda729799fe9b3848dbe2c211d4b231032b81e`.
- Agent backend: `gpt-5.6-luna`, high reasoning effort, through
  `relay-dsh-plugin-codex`.
- Registry export:
  `discovery.composite.2026-09-06.v1-0-5.b92b985e31df`, 14,829 records.
- Semantic directory: `plugin-directory-semantic-v3-18`.
- Export file digest:
  `sha256:d03f7dbe79a0a9cda3129a5945b08e5b97aebe6dd346736d3232c2a94bbe6e4a`.
- Reconstructed DiscoverySnapshot canonical-entry digest:
  `sha256:62f266eaab41de08419c854d7953952c1ca2983f8ef63d9719904c3d1c0997e6`.

The two digests intentionally cover different byte representations. The first
is the frozen JSONL export; the second is the Registry contract's canonical
JSON-array digest. Snapshot id and entry count are checked before DSH starts,
and the semantic directory must reference that exact snapshot id.

## Scenario and result

The user task was: keep watching a local program and send its result to Lark
when it exits. The live Agent had to keep process-state reading, durable
monitoring/session resumption, and Lark delivery as three distinct required
responsibilities.

The passing session made exactly two read-only calls:

1. one `search_roles` call with three focused role queries and eight candidates
   per role;
2. one `assess_solution` call selecting one primary candidate per role.

The assessed solution was complete, with three covered required roles, no
missing roles, no alternatives, and three globally unique plugins:

- `relay-dsh-plugin-monitor-process@0.1.1` for process-state reading;
- `relay-dsh-plugin-monitors@0.3.1` for durable repeated checks and resumption;
- `dsh-lark-channel@0.0.7` for Lark delivery.

There were no failed discovery workflow calls, redundant `inspect` calls, or
`plugin_manage` calls. Four candidates in the reviewed pools carried semantic
directory evidence. Directory evidence is recorded as a metric rather than a
per-selected-plugin gate: a correct resolved candidate may be supplied by the
keyword side of hybrid retrieval when the broader directory path does not
match a highly specific role query. Aggregate directory contribution and
retrieval regression remain gated separately by A-035.

Run the acceptance with:

```sh
npm run acceptance:live:dsh-task-solution
```

The command is read-only outside temporary files. It does not install into the
source Profile and does not access or mutate the production Registry database.
