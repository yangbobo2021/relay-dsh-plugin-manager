# Search Scenario Acceptance — 2026-09-11

This record captures A-035 against the local production-sized Registry snapshot
and semantic directory. It compares the former keyword strategy with the new
hybrid candidate strategy after simulated identity inspection and project
deduplication.

- Registry origin: local read-only server at `127.0.0.1:4199`
- Discovery entries: 14,829
- Snapshot: `discovery.composite.2026-09-06.v1-0-5.b92b985e31df`
- Directory: `plugin-directory-semantic-v3-18`
- Suite: `plugin-manager-search.2026-09-11.v1`
- Evaluations: 16 scenarios in Chinese and English, plus 3 exact queries

| Gate | Keyword baseline | Hybrid candidate |
| --- | ---: | ---: |
| Scenario evaluations passed | 30 / 32 | 32 / 32 |
| Required solution roles covered | 35 / 36 | 36 / 36 |
| Reviewed forbidden neighbours suppressed | 7 / 8 | 8 / 8 |
| Duplicate project identities | 0 | 0 |
| Exact identifiers at required rank | 3 / 3 | 3 / 3 |
| Individual hard-check regressions | — | 0 |

The hybrid strategy passed every hard gate. Its recall at rank 10 was lower
(`0.888889` versus `0.944444`) because some required roles moved to ranks 11–20,
but no required role was lost from the bounded result pool. This rank metric is
therefore retained for diagnosis and is not allowed to override complete role
coverage or non-redundancy.

The run used Registry identity simulation for the large scenario comparison;
immutable npm/GitHub resolution is covered separately by unit, integration, and
live Registry smoke acceptance. No production state was changed.
