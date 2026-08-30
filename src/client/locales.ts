/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '推荐插件',
  requiresLabel: '需要',
  installLabel: '安装',
  verifyLabel: '装好后',
  claudePackage: 'relay-dsh-plugin-claude',
  claudePurpose: '在 DSH 里使用 Claude Code',
  claudeRequires: '本机的 Claude Code 已能正常调用',
  claudeInstall: '在聊天里发送「安装 npm 包 relay-dsh-plugin-claude」',
  claudeVerify: '新建会话，在模式菜单里选 Claude Code',
  codexPackage: 'relay-dsh-plugin-codex',
  codexPurpose: '在 DSH 里使用 Codex',
  codexRequires: '本机的 Codex 已能正常调用',
  codexInstall: '在聊天里发送「安装 npm 包 relay-dsh-plugin-codex」',
  codexVerify: '新建会话，在模式菜单里选 Codex',
  otherLead: '想安装/查看/卸载其他插件？',
  other: '直接在聊天里说，比如「找一个能发送系统通知的插件」「卸载 relay-dsh-plugin-codex」。',
} satisfies Record<string, string>

export type MarketplaceLocaleKey = keyof typeof zh

/** English dictionary, mirroring every Simplified Chinese key. */
export const en = {
  tab: 'Recommended plugins',
  requiresLabel: 'Requires',
  installLabel: 'Install',
  verifyLabel: 'After install',
  claudePackage: 'relay-dsh-plugin-claude',
  claudePurpose: 'Use Claude Code inside DSH',
  claudeRequires: 'Claude Code already works on this machine',
  claudeInstall: 'Send “install the npm package relay-dsh-plugin-claude” in chat',
  claudeVerify: 'Start a session and pick Claude Code from the mode menu',
  codexPackage: 'relay-dsh-plugin-codex',
  codexPurpose: 'Use Codex inside DSH',
  codexRequires: 'Codex already works on this machine',
  codexInstall: 'Send “install the npm package relay-dsh-plugin-codex” in chat',
  codexVerify: 'Start a session and pick Codex from the mode menu',
  otherLead: 'Want to install, review, or remove another plugin?',
  other: 'Just say so in chat — “find a plugin that sends desktop notifications”, “remove relay-dsh-plugin-codex”.',
} satisfies Record<MarketplaceLocaleKey, string>
