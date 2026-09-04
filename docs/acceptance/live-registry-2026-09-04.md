# Live DSH Registry Acceptance — 2026-09-04

This record captures A-032 against the formal beta Registry and real public
npm/GitHub metadata. It does not install or mutate a DSH Profile.

## Inputs

- Registry origin: `https://dsh-plugins.tech`
- Registry release: `25e64a93599d255ba65ea63ee77b47b62a2e6cd8`
- Discovery snapshot: `discovery.awesome-dsh-plugin.2026-09-03.v1-0-2.5346e7049c20`
- Discovery entries: 3,019
- Command: `npm run acceptance:live:registry`

## Results

| Scenario | Result |
| --- | --- |
| Chinese task `管理插件` | Passed; five locally inspected candidates |
| English task `workspace files` | Passed; five locally inspected candidates |
| Exact name `dsh-plugin-manager` | Passed; four locally inspected candidates and one rejected malformed/non-plugin source |
| Deliberate missing name | Passed; honest empty result without provider failure |
| Registry authority | Passed; `source_only`, `untrusted_text`, `is_final_recommendation: false`, `grants_install_approval: false` |
| Local resolution | Passed; every surfaced candidate resolved to an exact npm SemVer or full GitHub commit before presentation |

The live run returned no Registry provider errors. Unit and host integration
tests separately prove request minimization, locale selection, endpoint
validation, explicit opt-out, malformed-response rejection, provider failure
isolation and mandatory local inspection.
