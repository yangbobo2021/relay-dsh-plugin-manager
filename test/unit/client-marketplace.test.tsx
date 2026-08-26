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

describe('PM-021/A-023 Plugin Marketplace help', () => {
  it('renders concise Chinese guidance for the four conversation workflows', () => {
    const html = render(zh)

    expect(html).toContain(zh.title)
    expect(html).toContain(zh.confirmation)
    expect(html).toContain(zh.searchPrompt)
    expect(html).toContain(zh.installPrompt)
    expect(html).toContain(zh.removePrompt)
    expect(html).toContain(zh.listPrompt)
    expect(html).toContain('/plugins')
    expect(html.match(/data-chat-prompt="true"/gu)).toHaveLength(4)
  })

  it('renders the same help contract in English without action controls', () => {
    const html = render(en)

    expect(html).toContain(en.title)
    expect(html).toContain(en.confirmation)
    expect(html.match(/data-chat-prompt="true"/gu)).toHaveLength(4)
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
      order: 20,
      locale: NS,
    })
    expect(options).not.toHaveProperty('inject')
    expect(options.label()).toBe(zh.tab)
    expect(component).toBe(MarketplaceSettingsTab)
  })
})
