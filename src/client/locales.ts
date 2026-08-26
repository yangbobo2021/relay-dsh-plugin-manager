/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件市场',
  title: '在聊天中管理插件',
  intro: '直接在聊天窗口描述你想做的事。DSH 会帮助你寻找插件，并通过对话完成安装和管理。',
  confirmation: '安装、卸载、启用或停用前，DSH 会先展示操作计划，并等待你的确认。',
  examples: '你可以这样说',
  searchLabel: '寻找插件',
  searchPrompt: '找一个能连接飞书的插件',
  installLabel: '安装插件',
  installPrompt: '安装 relay-dsh-plugin-codex',
  removeLabel: '卸载插件',
  removePrompt: '卸载 relay-dsh-plugin-codex',
  listLabel: '查看插件',
  listPrompt: '列出当前已安装的插件',
  commandHint: '也可以在聊天窗口输入 /plugins，后面跟上同样的请求。',
} satisfies Record<string, string>

/** Locale key union shared by the tab component and registration. */
export type MarketplaceLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin marketplace',
  title: 'Manage plugins in Chat',
  intro: 'Describe what you need in the Chat window. DSH can find plugins and manage them through conversation.',
  confirmation: 'Before installing, removing, enabling, or disabling anything, DSH shows a plan and waits for your confirmation.',
  examples: 'Try asking',
  searchLabel: 'Find a plugin',
  searchPrompt: 'Find a plugin that connects to Lark',
  installLabel: 'Install a plugin',
  installPrompt: 'Install relay-dsh-plugin-codex',
  removeLabel: 'Remove a plugin',
  removePrompt: 'Remove relay-dsh-plugin-codex',
  listLabel: 'View plugins',
  listPrompt: 'List the currently installed plugins',
  commandHint: 'You can also type /plugins in Chat, followed by the same request.',
} satisfies Record<MarketplaceLocaleKey, string>
