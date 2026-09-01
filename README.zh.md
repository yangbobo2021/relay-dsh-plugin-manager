# 在 DeepSeek Harness 对话中管理插件

> **现已支持最新 DSH `0.1.2-alpha.3`。** 插件 `0.2.1` 已在 DSH `0.1.2-alpha.3`、`0.1.2-alpha.2` 与 `0.1.1-rc.2` 上完成兼容验证。[安装插件，立即体验最新版 DSH](https://www.npmjs.com/package/relay-dsh-plugin-manager) · [兼容性详情](docs/dsh-0.1.2-alpha.3.md)。

> **发布通道：** `latest` → `0.2.1`；`next` → `0.2.1-rc.1`。

```bash
npx @deepseek-ai/dsh@0.1.2-alpha.3 plugin --profile web add relay-dsh-plugin-manager@0.2.1
npx @deepseek-ai/dsh@0.1.2-alpha.3 web
```

[![npm 版本](https://img.shields.io/npm/v/relay-dsh-plugin-manager?label=npm)](https://www.npmjs.com/package/relay-dsh-plugin-manager)
[![CI](https://github.com/yangbobo2021/relay-dsh-plugin-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/yangbobo2021/relay-dsh-plugin-manager/actions/workflows/ci.yml)
[![npm 月下载量](https://img.shields.io/npm/dm/relay-dsh-plugin-manager?label=downloads)](https://www.npmjs.com/package/relay-dsh-plugin-manager)
[![GitHub Stars](https://img.shields.io/github/stars/yangbobo2021/relay-dsh-plugin-manager?style=flat)](https://github.com/yangbobo2021/relay-dsh-plugin-manager/stargazers)
[![MIT 许可证](https://img.shields.io/github/license/yangbobo2021/relay-dsh-plugin-manager)](LICENSE)
[![DSH 兼容版本](https://img.shields.io/badge/DSH-0.1.1--rc.2%20%7C%200.1.2--alpha.2%20%7C%200.1.2--alpha.3-2f7d68)](https://github.com/deepseek-ai/deepseek-harness)
[![npm 可信发布](https://img.shields.io/badge/npm_trusted_publishing-enabled-2f9e44)](.github/workflows/release.yml)

[English](README.md) | 中文

**npm 包名：** [`relay-dsh-plugin-manager`](https://www.npmjs.com/package/relay-dsh-plugin-manager)
· [Relay DSH 插件目录](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/dsh-plugins.zh.md)

**只需描述需要的能力，就能查找和管理 DSH 插件；不必离开对话，也不必手工
编辑 Profile 文件。**

`relay-dsh-plugin-manager` 让 DeepSeek Harness Chat 可以查找、安装、更新、
启用、停用和卸载插件。搜索和查看只读；任何变更执行前，DSH 都会先展示计划，
并等待单独确认。

[![插件管理器在 DSH 中成功安装 relay-dsh-plugin-codex](https://raw.githubusercontent.com/yangbobo2021/Relay/codex/relay-foundation/docs/media/dsh-plugin-manager-codex-install-success.png)](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/media/dsh-plugin-manager-codex-install-demo.zh.mp4?raw=1)

*查看 [38 秒真实 DSH 运行录像](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/media/dsh-plugin-manager-codex-install-demo.zh.mp4?raw=1)：
从搜索、查看不产生变更的计划、单独确认，到 Codex 插件安装完成。录像基于官方
DSH 提交
[`b150a551`](https://github.com/deepseek-ai/deepseek-harness/commit/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e)，
使用 Plugin Manager `0.1.0-rc.2` 和 Codex 插件 `0.1.2`。*

如果这种对话式插件管理对你有用，欢迎
[Star 本插件](https://github.com/yangbobo2021/relay-dsh-plugin-manager)，并
[反馈安装结果或缺少的插件场景](https://github.com/yangbobo2021/relay-dsh-plugin-manager/issues)。

## 安装

如果你自行安装了官方 DSH，请先停止 DSH Web，再通过 DSH CLI 安装 npm 正式包：

```bash
dsh plugin --profile web add relay-dsh-plugin-manager@latest
```

然后启动或重启 DSH Web：

```bash
dsh web
```

如果 `PATH` 中没有 `dsh`，请在两条命令中将它替换为
`pnpm dlx @deepseek-ai/dsh@0.1.2-alpha.3`。

安装后，**设置 > 插件** 会默认打开 **推荐插件** 标签页，在这里介绍推荐的
对话后端插件，并附一份简短帮助。实际的插件管理仍在 Chat 对话中完成。

### KeySync 已内置安装

通过 [KeySync](https://sublang.ai/keysync/dl-dy) 一键安装 DSH 时，本插件会作为
内置插件自动安装，不需要再次执行上面的安装命令。该命令只适用于独立安装的
官方 DSH，或已经移除本插件的 Profile。

## 使用

直接用自然语言描述需求即可：

```text
找一个能连接飞书的插件
查找 GitHub 用户 yangbobo2021 发布的 DSH 插件
安装 relay-dsh-plugin-codex
一起安装 relay-dsh-plugin-codex、relay-dsh-plugin-files 和 relay-dsh-plugin-terminal
列出已安装插件及其状态
停用 example-dsh-plugin
卸载 example-dsh-plugin
```

也可以只使用一个 `/plugins` 命令：

```text
/plugins 找一个工作区文件浏览插件
/plugins 搜索 owner:yangbobo2021
/plugins 安装 relay-dsh-plugin-files
```

搜索和查看不会修改配置。安装、更新、卸载、启用、停用和重启都会先展示计划。
你可以直接在 DSH 的选项界面中确认，也可以在后续 Chat 消息中明确批准。
一次请求安装多个插件时，DSH 会展示一份有序计划和缺失的配套 peer 插件，等待
一次确认后依次安装。修改完成但仍需重启时，状态会明确区分“需要另行重启”和
“等待人工重启”。

## 与 Relay 的关系

本插件在 [Relay](https://github.com/yangbobo2021/Relay) 的 integration 工作区中
开发，同时作为可独立安装的 DSH 插件发布。Relay 主要探索长时间运行的 Agent、
外部事件投递、可复用 DSH 视图，以及多种对话后端。

你还可以试试这些 Relay DSH 插件：

- [Codex 对话](https://github.com/yangbobo2021/relay-dsh-plugin-codex)
- [Claude Code 对话](https://github.com/yangbobo2021/relay-dsh-plugin-claude)
- [Workbench 面板](https://github.com/yangbobo2021/relay-dsh-plugin-workbench)
- [工作区文件浏览](https://github.com/yangbobo2021/relay-dsh-plugin-files)
- [Terminal 终端](https://github.com/yangbobo2021/relay-dsh-plugin-terminal)

更多安装组合和兼容性说明见
[Relay DSH 插件完整指南](https://github.com/yangbobo2021/Relay/blob/codex/relay-foundation/docs/dsh-plugins.zh.md)。

## 反馈

问题和需求可以提交到本仓库的
[Issue Tracker](https://github.com/yangbobo2021/relay-dsh-plugin-manager/issues)。
