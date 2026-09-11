# Live Task-Role Model Acceptance — 2026-09-11

This record captures A-037 for Agent-authored semantic role plans. It is
separate from the deterministic A-036 runtime workflow: passing JSON validation
or finding candidates is not accepted as proof that the plan is complete.

The checked-in suite is
`fixtures/evaluation/task-role-model-scenarios.v1.json`. Six tasks are evaluated
in Chinese and English, for twelve independent plans. The model receives only
the task text and role-planning rules; expected concepts and forbidden phrases
remain evaluator-only.

The hard checks require:

1. The exact reviewed minimal role count.
2. A distinct observed role for every expected semantic responsibility.
3. Correct required versus explicitly optional status.
4. No invented terminal or shell role for workspace file browsing.
5. The exact ambiguity count and recognition of an unspecified notification
   channel.
6. Separate state/event-reading and durable Session-resumption coverage for
   cross-time monitoring, even when one plugin can later satisfy both roles.

Negative unit cases prove that merged/missing roles, wrong optionality, missing
ambiguity, forbidden roles, and missing/duplicate/unexpected plans fail. The
semantic matcher uses one-to-one maximum matching, so one observed role cannot
claim two expected responsibilities.

An opt-in run with `gpt-5.6-luna` at high reasoning effort produced these final
results:

| Check | Result |
| --- | ---: |
| Plans | 12 / 12 |
| Exact role counts | 12 / 12 |
| Distinct role concepts | 26 / 26 |
| Required/optional flags | 26 / 26 |
| Forbidden-role checks | 6 / 6 |
| Exact ambiguity counts | 12 / 12 |
| Ambiguity concepts | 2 / 2 |

Run it with `npm run acceptance:live:task-roles`. The command uses an ephemeral,
read-only Codex execution, writes no credentials, performs no plugin search or
mutation, and only writes a full report when
`DSH_TASK_ROLE_ACCEPTANCE_OUTPUT` is explicitly set.
