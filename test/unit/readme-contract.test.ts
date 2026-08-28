import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')
const english = readFileSync(resolve(root, 'README.md'), 'utf8')
const chinese = readFileSync(resolve(root, 'README.zh.md'), 'utf8')
const install = 'dsh plugin --profile web add relay-dsh-plugin-manager@latest'
const relatedPlugins = [
  'relay-dsh-plugin-codex',
  'relay-dsh-plugin-claude',
  'relay-dsh-plugin-workbench',
  'relay-dsh-plugin-files',
  'relay-dsh-plugin-terminal',
]

describe('README delivery contract', () => {
  it('ships matching English and Chinese quick-start documents', () => {
    expect(english).toContain('English | [中文](README.zh.md)')
    expect(chinese).toContain('[English](README.md) | 中文')
    expect(english).toContain(install)
    expect(chinese).toContain(install)
  })

  it('documents KeySync installation and the Relay plugin ecosystem', () => {
    expect(english).toMatch(/KeySync[\s\S]+installed automatically/u)
    expect(chinese).toMatch(/KeySync[\s\S]+内置插件自动安装/u)
    expect(english).toContain('https://github.com/yangbobo2021/Relay')
    expect(chinese).toContain('https://github.com/yangbobo2021/Relay')
    for (const plugin of relatedPlugins) {
      expect(english).toContain(`https://github.com/yangbobo2021/${plugin}`)
      expect(chinese).toContain(`https://github.com/yangbobo2021/${plugin}`)
    }
  })

  it('documents one-confirmation multi-plugin installation in both languages', () => {
    for (const plugin of ['relay-dsh-plugin-codex', 'relay-dsh-plugin-files', 'relay-dsh-plugin-terminal']) {
      expect(english).toContain(plugin)
      expect(chinese).toContain(plugin)
    }
    expect(english).toMatch(/one confirmation[\s\S]+sequence/u)
    expect(chinese).toMatch(/一次确认[\s\S]+依次安装/u)
  })

  it('documents both controlled UI and later-message confirmation paths', () => {
    expect(english).toMatch(/DSH's choice[\s\S]+later Chat message/u)
    expect(chinese).toMatch(/DSH 的选项界面[\s\S]+后续 Chat 消息/u)
  })
})
