/** Read-only recommended-plugins help registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MarketplaceSettingsTab } from './MarketplaceSettingsTab.tsx'
import { en, zh, type MarketplaceLocaleKey } from './locales.ts'

export type { MarketplaceSettingsTabProps } from './MarketplaceSettingsTab.tsx'
export type { MarketplaceLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only conversation help for plugin discovery and management. */
    'settings.pluginMarketplace': MarketplaceLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginMarketplace'

/** The tab needs only the Settings slot ledger and locale service. */
export const inject = ['slots', 'locale']

/** Contribute the localized help tab to Settings > Plugins. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'relay-plugin-manager: marketplace dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'marketplace',
    order: -10,
    label: () => t('tab'),
    locale: NS,
  }, MarketplaceSettingsTab))
}
