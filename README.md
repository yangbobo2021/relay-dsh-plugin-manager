# Manage DeepSeek Harness Plugins from Chat

[![npm version](https://img.shields.io/npm/v/relay-dsh-plugin-manager?label=npm)](https://www.npmjs.com/package/relay-dsh-plugin-manager)
[![CI](https://github.com/yangbobo2021/relay-dsh-plugin-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/yangbobo2021/relay-dsh-plugin-manager/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/relay-dsh-plugin-manager?label=downloads)](https://www.npmjs.com/package/relay-dsh-plugin-manager)
[![GitHub stars](https://img.shields.io/github/stars/yangbobo2021/relay-dsh-plugin-manager?style=flat)](https://github.com/yangbobo2021/relay-dsh-plugin-manager/stargazers)
[![MIT license](https://img.shields.io/github/license/yangbobo2021/relay-dsh-plugin-manager)](LICENSE)
[![DSH compatibility](https://img.shields.io/badge/DSH-0.1.1--rc.2-2f7d68)](https://github.com/deepseek-ai/deepseek-harness)
[![npm trusted publishing](https://img.shields.io/badge/npm_trusted_publishing-enabled-2f9e44)](.github/workflows/release.yml)

English | [中文](README.zh.md)

**npm package:** [`relay-dsh-plugin-manager`](https://www.npmjs.com/package/relay-dsh-plugin-manager)
· [Relay DSH plugin catalog](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/dsh-plugins.md)

**Find and manage DSH plugins by describing what you need, without leaving the
conversation or editing Profile files by hand.**

`relay-dsh-plugin-manager` lets DeepSeek Harness Chat discover, install, update,
enable, disable, and remove plugins. Search and inspection are read-only. Before
any change, DSH shows the plan and waits for a separate confirmation.

[![Plugin Manager installs relay-dsh-plugin-codex successfully in DSH](https://raw.githubusercontent.com/yangbobo2021/Relay/codex/relay-foundation/docs/media/dsh-plugin-manager-codex-install-success.png)](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/media/dsh-plugin-manager-codex-install-demo.en.mp4?raw=1)

*Watch the [40-second real DSH run](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/media/dsh-plugin-manager-codex-install-demo.en.mp4?raw=1):
search, review a no-change plan, confirm separately, and finish with the Codex
plugin installed. Recorded on official DSH commit
[`b150a551`](https://github.com/deepseek-ai/deepseek-harness/commit/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)
with Plugin Manager `0.1.0-rc.3` and Codex plugin `0.1.2`.*

If conversation-first plugin management is useful to you,
[star this plugin](https://github.com/yangbobo2021/relay-dsh-plugin-manager) and
[share your install result or missing plugin use case](https://github.com/yangbobo2021/relay-dsh-plugin-manager/issues).

## Install

If you installed official DSH yourself, stop DSH Web and install the published
npm package with the DSH CLI:

```bash
dsh plugin --profile web add relay-dsh-plugin-manager@latest
```

Then start or restart DSH Web:

```bash
dsh web
```

If `dsh` is not on `PATH`, replace it with
`pnpm dlx @deepseek-ai/dsh@0.1.1-rc.2` in both commands.

The plugin appears under **Settings > Plugins > Plugin marketplace**. This page
is a short help view; plugin management itself happens in Chat.

### Installed by KeySync

When you use [KeySync](https://sublang.ai/keysync/download/) to install DSH with
its one-click setup, this plugin is included and installed automatically. You do
not need to install it again. The command above is for standalone official DSH
installations or Profiles where the plugin was removed.

## Use

Describe what you want in ordinary language:

```text
Find a plugin that connects to Lark
Install relay-dsh-plugin-codex
List my installed plugins and their status
Disable example-dsh-plugin
Remove example-dsh-plugin
```

You can also use the single `/plugins` command:

```text
/plugins find a workspace file browser
/plugins install relay-dsh-plugin-files
```

Search and inspection are read-only. Installation, update, removal, enablement,
disablement, and restart always show a plan and require a later confirmation.

## Part of Relay

This plugin is developed in the
[Relay](https://github.com/yangbobo2021/Relay) integration workspace and is
published as an independently installable DSH plugin. Relay explores durable
Agent work, external-event delivery, reusable DSH views, and multiple
conversation backends.

Other Relay DSH plugins:

- [Codex conversations](https://github.com/yangbobo2021/relay-dsh-plugin-codex)
- [Claude Code conversations](https://github.com/yangbobo2021/relay-dsh-plugin-claude)
- [Workbench panels](https://github.com/yangbobo2021/relay-dsh-plugin-workbench)
- [Workspace files](https://github.com/yangbobo2021/relay-dsh-plugin-files)
- [Terminal](https://github.com/yangbobo2021/relay-dsh-plugin-terminal)

See the [complete Relay DSH plugin guide](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/dsh-plugins.md)
for installation combinations and compatibility notes.

## Feedback

Report bugs and feature requests in the
[issue tracker](https://github.com/yangbobo2021/relay-dsh-plugin-manager/issues).
