import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketplaceLocaleKey } from './locales.ts'

/** Props assembled by the Settings slot renderer. */
export type MarketplaceSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginMarketplace'>

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

const styles = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    width: '100%',
    maxWidth: 640,
    color: 'var(--dsw-alias-label-primary)',
  },
  plugins: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  plugin: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '16px 18px',
  },
  pluginHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  packageName: {
    margin: 0,
    fontFamily: MONO,
    fontSize: 15,
    lineHeight: '22px',
    fontWeight: 600,
  },
  purpose: {
    margin: 0,
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 13,
    lineHeight: '20px',
  },
  facts: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  factRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 12,
    rowGap: 2,
  },
  label: {
    flex: '0 0 52px',
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
    lineHeight: '20px',
  },
  value: {
    flex: '1 1 240px',
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 13,
    lineHeight: '20px',
  },
  installValue: {
    flex: '1 1 240px',
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 13,
    lineHeight: '20px',
  },
  aside: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    borderTop: '1px solid var(--dsw-alias-border-l2)',
    paddingTop: 14,
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 13,
    lineHeight: '20px',
  },
  asideIcon: {
    flex: '0 0 auto',
    marginTop: 3,
  },
  asideLead: {
    color: 'var(--dsw-alias-label-primary)',
    fontWeight: 600,
  },
} satisfies Record<string, CSSProperties>

/** The recommended plugins, in the order the tab presents them. */
const recommendedKeys = [
  {
    package: 'claudePackage',
    purpose: 'claudePurpose',
    requires: 'claudeRequires',
    install: 'claudeInstall',
    verify: 'claudeVerify',
  },
  {
    package: 'codexPackage',
    purpose: 'codexPurpose',
    requires: 'codexRequires',
    install: 'codexInstall',
    verify: 'codexVerify',
  },
] as const satisfies readonly Record<'package' | 'purpose' | 'requires' | 'install' | 'verify', MarketplaceLocaleKey>[]

/** Dependency-free info glyph marking the tab's one aside. */
function InfoIcon(): ReactNode {
  return (
    <svg
      style={styles.asideIcon}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7.2v4" strokeLinecap="round" />
      <path d="M8 4.9v.1" strokeLinecap="round" />
    </svg>
  )
}

/** Render one self-contained card per recommended plugin, then one aside. */
export function MarketplaceSettingsTab({ t }: MarketplaceSettingsTabProps): ReactNode {
  return (
    <section style={styles.section} data-plugin-marketplace-help>
      <div style={styles.plugins}>
        {recommendedKeys.map((plugin) => (
          <article style={styles.plugin} key={plugin.package} data-recommended-plugin>
            <header style={styles.pluginHeader}>
              <h4 style={styles.packageName} data-plugin-package>{t(plugin.package)}</h4>
              <p style={styles.purpose}>{t(plugin.purpose)}</p>
            </header>
            <ul style={styles.facts}>
              <li style={styles.factRow}>
                <span style={styles.label}>{t('requiresLabel')}</span>
                <span style={styles.value}>{t(plugin.requires)}</span>
              </li>
              <li style={styles.factRow}>
                <span style={styles.label}>{t('installLabel')}</span>
                <span style={styles.installValue} data-chat-prompt>{t(plugin.install)}</span>
              </li>
              <li style={styles.factRow}>
                <span style={styles.label}>{t('verifyLabel')}</span>
                <span style={styles.value}>{t(plugin.verify)}</span>
              </li>
            </ul>
          </article>
        ))}
      </div>
      <p style={styles.aside}>
        <InfoIcon />
        <span>
          <strong style={styles.asideLead}>{t('otherLead')}</strong>
          {' '}
          {t('other')}
        </span>
      </p>
    </section>
  )
}
