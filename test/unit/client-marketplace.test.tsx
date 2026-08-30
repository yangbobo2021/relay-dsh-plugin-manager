import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MarketplaceSettingsTab, type MarketplaceSettingsTabProps } from '../../src/client/MarketplaceSettingsTab.tsx'
import { apply, inject, NS } from '../../src/client/index.tsx'
import { en, type MarketplaceLocaleKey, zh } from '../../src/client/locales.ts'

function render(dictionary: Record<MarketplaceLocaleKey, string>): string {
  const t = ((key: MarketplaceLocaleKey): string => dictionary[key]) as MarketplaceSettingsTabProps['t']
  return renderToStaticMarkup(createElement(
    MarketplaceSettingsTab,
    { t } as MarketplaceSettingsTabProps,
  ))
}

describe('PM-021/A-023 Recommended plugins help', () => {
  it('gives every recommended plugin a self-contained card', () => {
    const html = render(zh)

    for (const plugin of [
      { name: zh.claudePackage, purpose: zh.claudePurpose, requires: zh.claudeRequires, install: zh.claudeInstall, verify: zh.claudeVerify },
      { name: zh.codexPackage, purpose: zh.codexPurpose, requires: zh.codexRequires, install: zh.codexInstall, verify: zh.codexVerify },
    ]) {
      for (const copy of Object.values(plugin)) expect(html).toContain(copy)
    }
    expect(html.match(/data-recommended-plugin/gu)).toHaveLength(2)
    expect(html.match(/data-plugin-package/gu)).toHaveLength(2)

    // Each install line is one message a reader can send as-is. Splitting the
    // grammar from the package name would make the reader assemble it.
    expect(zh.claudeInstall).toContain(zh.claudePackage)
    expect(zh.codexInstall).toContain(zh.codexPackage)
    expect(html.match(/data-chat-prompt="true"/gu)).toHaveLength(2)

    // The exact package name is what keeps an install request off a registry
    // search, where neither plugin is currently indexed.
    expect(zh.claudePackage).toBe('relay-dsh-plugin-claude')
    expect(zh.codexPackage).toBe('relay-dsh-plugin-codex')

    // Tab-level copy must stay true of any future recommended plugin, so it
    // claims nothing about a specific one. zh.other is exempt: it quotes
    // example chat messages rather than describing the recommended plugins.
    for (const shared of [zh.otherLead]) {
      expect(shared).not.toContain('Claude')
      expect(shared).not.toContain('Codex')
      expect(shared).not.toContain('relay-dsh-plugin')
    }
    for (const shared of [zh.otherLead, zh.other]) expect(html).toContain(shared)

    // Each post-install check names the backend to pick, not "it": the reader
    // is looking at a mode menu listing every installed backend.
    expect(zh.claudeVerify).toContain('Claude Code')
    expect(zh.codexVerify).toContain('Codex')
    expect(html.indexOf(zh.claudePackage)).toBeLessThan(html.indexOf(zh.otherLead))
  })

  it('renders the same help contract in English without action controls', () => {
    const html = render(en)

    expect(html).toContain(en.claudeRequires)
    expect(html).toContain(en.codexRequires)
    expect(html).toContain(en.other)
    expect(en.claudeInstall).toContain(en.claudePackage)
    expect(en.codexInstall).toContain(en.codexPackage)
    expect(html.match(/data-recommended-plugin/gu)).toHaveLength(2)
    expect(html.match(/data-chat-prompt="true"/gu)).toHaveLength(2)
    expect(html).not.toMatch(/<(?:button|input|form|a)\b/gu)
  })

  it('registers exactly one localized, dependency-free Settings tab', () => {
    const dictionaries = vi.fn(() => undefined)
    const bind = vi.fn(() => (key: MarketplaceLocaleKey) => zh[key])
    const register = vi.fn((_options: {
      name: string
      id: string
      order: number
      label: () => string
      locale: string
    }, _component: unknown) => () => undefined)
    const slotInject = vi.fn((_name: string, contribution: () => unknown) => contribution())
    const effect = vi.fn((setup: () => unknown) => setup())
    const ctx = {
      effect,
      locale: { register: dictionaries, bind },
      slots: { inject: slotInject, register },
    }

    apply(ctx as never)

    expect(inject).toEqual(['slots', 'locale'])
    expect(dictionaries).toHaveBeenCalledWith(NS, { zh, en })
    expect(register).toHaveBeenCalledOnce()
    const [options, component] = register.mock.calls[0]!
    expect(options).toMatchObject({
      name: 'settings.plugins.tab',
      id: 'marketplace',
      order: -10,
      locale: NS,
    })
    expect(options).not.toHaveProperty('inject')
    expect(options.label()).toBe(zh.tab)
    expect(component).toBe(MarketplaceSettingsTab)
  })
})
