# Release Candidate Acceptance - 2026-08-26

## Scope

Release acceptance for `relay-dsh-plugin-manager@0.1.0-rc.1` in an isolated
real DSH Web profile. The manager was installed from its packed tarball and
`relay-dsh-plugin-codex@0.1.2` was installed from npm through the official
DSH CLI.

## Environment

| Item | Value |
|---|---|
| Official DSH commit | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Codex plugin | `relay-dsh-plugin-codex@0.1.2` |
| Codex CLI | `0.149.0-alpha.4.3` |
| Codex model route | `relay-codex/gpt-5.4-mini` |
| Profile | fresh temporary `web` profile |

No production DSH profile or repository checkout was modified.

## Conversation Evidence

| Scenario | Result |
|---|---|
| Real Web boot | Passed; DSH returned a readiness URL and HTTP 200 |
| Agent preset roster | Passed; `relay-codex` was available |
| Compact model surface | Passed; request header contained exactly `plugin_discover` and `plugin_manage` |
| Slash command | Passed; `/plugins 搜索 Codex 插件` produced merged live search results |
| Natural language | Passed; a Chinese discovery request ran on the real Codex backend and returned inspected DSH candidates |
| No mutation on search | Passed |
| Same-turn confirmation | Passed; “disable and confirm now” produced a plan, execution was rejected, and `cordis.patch.yml` stayed byte-identical |
| Later confirmation | Passed; a later `确认禁用` message wrote the owned `relay-codex-host` disabled row |
| Loader hot unload | Passed; the Codex provider was disposed without restarting DSH |
| Loader hot reload | Passed; removing the temporary acceptance override restored the Codex provider without restarting DSH; a new real Codex Session replied `CODEX_HMR_OK` |

## Review Finding

Disabling the backend serving the executing conversation interrupts that turn
when Loader HMR disposes the provider. The profile mutation is successful and
DSH itself does not restart, but the conversation cannot deliver a final
success message from the disabled backend.

The release contract, plan output, README, technical design, and integration
test now warn about this behavior. Continuity-sensitive disable operations
should be confirmed from another backend or Session.

## Cleanup

The temporary override was removed, the Codex provider was verified live again,
and the temporary DSH process and profile were deleted after the release run.
