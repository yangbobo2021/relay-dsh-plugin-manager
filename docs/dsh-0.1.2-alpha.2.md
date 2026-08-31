# DSH 0.1.2-alpha.2 compatibility (unreleased)

本分支适配官方 DSH `0.1.2-alpha.2`，提交
[`0a53fb55bea101816fa226bb964ae2bed71c343b`](https://github.com/deepseek-ai/deepseek-harness/commit/0a53fb55bea101816fa226bb964ae2bed71c343b)。
这是未发布的代码适配；插件版本号及 npm `latest` / `next` 未变更。
本分支不承诺继续兼容 `0.1.1-rc.2`。

## 变更

客户端公共服务入口；npm 开发依赖及官方 CLI fixture 升级；使用新版 scoped user-questions waterfall 验证确认流程；推荐插件页面保持只读。

## 本地验证

类型/语法检查、插件测试及构建：

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

除插件管理器使用 npm 官方包外，开发脚本从 `DSH_ROOT` 链接官方包并按
`exports.types` 生成本插件的声明映射，不再依赖已移除的 `dsh-client-runtime`。
官方 checkout 必须是上述版本，并已完成 `pnpm install` 和 `pnpm run build:lib`。
脚本不会修改官方源码。测试使用清理过的数据，不需要真实客户会话。


## 发布前检查限制

2026-08-31 部分本地验收通过，但官方新包发布不足 24 小时，fixture 的
`pnpm install --frozen-lockfile --ignore-scripts` 被发布时间策略拒绝。
没有保留 pnpm 自动生成的发布时间例外，也没有下调安全策略。
在依赖满足冷却期后，按现有 CI 再执行冻结安装和 `npm run acceptance`。

## 受控生命周期回归

```sh
npm run acceptance:controlled
```

使用隔离 Profile、本机 registry 的两个合成版本和真实官方 CLI，验证确认前
不修改 Profile、不执行安装命令，确认令牌不可重放，以及安装→禁用→启用→升级→卸载。
每一步冷启动真实 DSH，通过正式启动令牌换取 Cookie；检查实际加载的版本或没有加载。
不发送模型请求，不修改用户 Profile，不发布包，也不下调依赖安装安全策略。
可以通过 `RELAY_LIFECYCLE_EVIDENCE=/absolute/path/result.json` 保存证据。

控制器在宿主外运行，返回需要重启；这不覆盖热加载、会话内确认 UI、跨 Session
令牌校验、批量失败/取消、公开 npm/GitHub 来源以及其他真实插件的完整依赖组合。
脚本需要已构建的官方 checkout，可使用 `DSH_UPSTREAM_DIR` 和 `DSH_CLI_PATH` 指定路径。

## 合并与发布边界

合并到默认分支不代表已发布，也不代表向后兼容保护已经实现。旧 DSH 用户不要从 GitHub
默认分支安装本次适配代码，应继续使用已验证的旧版 npm 包或固定的旧版提交。
兼容检查和独立发布通道完成前，不得将本次适配发布到原有 `latest` / `next`。
