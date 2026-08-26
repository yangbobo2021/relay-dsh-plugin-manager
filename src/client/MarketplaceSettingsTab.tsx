import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketplaceLocaleKey } from './locales.ts'

/** Props assembled by the Settings slot renderer. */
export type MarketplaceSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginMarketplace'>

const styles = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    width: '100%',
    maxWidth: 720,
    color: 'var(--dsw-alias-label-primary)',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  title: {
    margin: 0,
    fontSize: 18,
    lineHeight: '26px',
    fontWeight: 600,
  },
  intro: {
    maxWidth: 620,
    margin: 0,
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 14,
    lineHeight: '22px',
  },
  notice: {
    margin: 0,
    borderLeft: '3px solid var(--dsw-alias-state-business-primary)',
    borderRadius: 6,
    padding: '10px 12px',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 13,
    lineHeight: '20px',
  },
  examples: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  examplesTitle: {
    margin: 0,
    fontSize: 13,
    lineHeight: '20px',
    fontWeight: 600,
  },
  list: {
    margin: 0,
    borderTop: '1px solid var(--dsw-alias-border-l2)',
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 16,
    rowGap: 4,
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    padding: '12px 2px',
  },
  label: {
    flex: '0 0 92px',
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
    lineHeight: '18px',
  },
  prompt: {
    flex: '1 1 220px',
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 14,
    lineHeight: '21px',
  },
  hint: {
    margin: 0,
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
    lineHeight: '19px',
  },
} satisfies Record<string, CSSProperties>

const exampleKeys = [
  ['searchLabel', 'searchPrompt'],
  ['installLabel', 'installPrompt'],
  ['removeLabel', 'removePrompt'],
  ['listLabel', 'listPrompt'],
] as const satisfies readonly (readonly [MarketplaceLocaleKey, MarketplaceLocaleKey])[]

/** Render concise, read-only guidance for conversation-based plugin management. */
export function MarketplaceSettingsTab({ t }: MarketplaceSettingsTabProps): ReactNode {
  return (
    <section style={styles.section} data-plugin-marketplace-help>
      <header style={styles.header}>
        <h3 style={styles.title}>{t('title')}</h3>
        <p style={styles.intro}>{t('intro')}</p>
      </header>
      <p style={styles.notice}>{t('confirmation')}</p>
      <div style={styles.examples}>
        <h4 style={styles.examplesTitle}>{t('examples')}</h4>
        <ul style={styles.list}>
          {exampleKeys.map(([label, prompt]) => (
            <li style={styles.row} key={prompt}>
              <span style={styles.label}>{t(label)}</span>
              <span style={styles.prompt} data-chat-prompt>{t(prompt)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p style={styles.hint}>{t('commandHint')}</p>
    </section>
  )
}
