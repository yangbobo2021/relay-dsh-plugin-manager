# Task Solution Acceptance — 2026-09-11

This record captures A-036 for the role-decomposition, grouped-search, and
completeness-assessment workflow.

The checked-in suite is
`fixtures/evaluation/task-solution-scenarios.v1.json`. It fixes six reviewed
examples:

1. A three-role process-monitoring and Lark-delivery task is complete only after
   all three required roles have a selected direct solution.
2. Missing Lark delivery leaves the same task incomplete.
3. Missing an explicitly optional dashboard does not block completeness.
4. One selected plugin can cover two roles while appearing once globally.
5. Two materially different Lark implementations remain grouped as primary and
   alternative, while an adjacent document plugin is not selected.
6. An unresolved notification-channel choice keeps an otherwise covered task
   ambiguous.

Negative tests reject duplicate role plans, duplicate labels or focused
queries, ambiguity ids that collide with role ids, candidates selected for the
wrong role, repeated candidate selection, and expired drafts.

The runtime guarantees are exercised at three layers:

- pure `TaskSolutionStore` scenario tests;
- `PluginManager` integration with independent per-role provider queries and
  inspected candidates;
- the real DSH `ToolRuntime` schema and execution path for `search_roles`
  followed by `assess_solution`.

The semantic role plan is intentionally Agent-authored: the manager does not
pretend that candidate presence proves relevance. It validates the structure,
preserves candidate boundaries, and computes completeness only from the
Agent-reviewed selections. Model-specific role-decomposition quality can be
evaluated against the same fixture in an opt-in live Agent run without changing
the deterministic release gates.

The full verification passed with 120 automated tests, package build, and local
DSH package installation against upstream commit
`76fda729799fe9b3848dbe2c211d4b231032b81e`. No production state was changed.
