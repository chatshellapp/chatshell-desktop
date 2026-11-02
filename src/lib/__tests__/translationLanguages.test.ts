import { describe, expect, it, vi } from 'vitest'
import {
  TRANSLATION_LANGUAGES,
  getDisplayName,
  getEnglishName,
  getShortCode,
  isTranslationLanguage,
  mapLocaleToLanguage,
  resolveDefaultLanguages,
} from '../translationLanguages'

describe('TRANSLATION_LANGUAGES', () => {
  it('splits Chinese and Portuguese into regional variants', () => {
    const codes = TRANSLATION_LANGUAGES.map((l) => l.code)
    expect(codes).toEqual(expect.arrayContaining(['zh-Hans', 'zh-Hant', 'pt-BR', 'pt-PT']))
    expect(codes).not.toContain('zh')
    expect(codes).not.toContain('pt')
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('isTranslationLanguage', () => {
  it('accepts catalog codes only', () => {
    expect(isTranslationLanguage('ja')).toBe(true)
    expect(isTranslationLanguage('auto')).toBe(false)
    expect(isTranslationLanguage('xx')).toBe(false)
    expect(isTranslationLanguage(null)).toBe(false)
  })
})

describe('names', () => {
  it('uses full English names for prompts', () => {
    expect(getEnglishName('zh-Hant')).toBe('Chinese (Traditional)')
    expect(getEnglishName('pt-BR')).toBe('Portuguese (Brazil)')
  })

  it('localizes display names to the UI locale', () => {
    expect(getDisplayName('ja', 'en')).toBe('Japanese')
    expect(getDisplayName('fr', 'fr')).toBe('français')
    expect(getDisplayName('zh-Hant', 'en')).toBe('Chinese (Traditional)')
  })

  it('normalizes the list-style variant names WebKit returns', () => {
    const of = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValue('Chinese, Simplified')
    try {
      expect(getDisplayName('zh-Hans', 'en-x-webkit')).toBe('Chinese (Simplified)')
      // Base languages keep commas that are part of the name.
      expect(getDisplayName('ja', 'en-x-webkit')).toBe('Chinese, Simplified')
    } finally {
      of.mockRestore()
    }
  })

  it('builds compact codes for narrow layouts', () => {
    expect(getShortCode('ko')).toBe('KO')
    expect(getShortCode('zh-Hant')).toBe('ZH-HANT')
  })
})

describe('mapLocaleToLanguage', () => {
  it.each([
    ['ja-JP', 'ja'],
    ['en_US.UTF-8', 'en'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-Hant-SG', 'zh-Hant'],
    ['zh-CN', 'zh-Hans'],
    ['zh-Hans-HK', 'zh-Hans'],
    ['zh', 'zh-Hans'],
    ['pt-BR', 'pt-BR'],
    ['pt', 'pt-PT'],
    ['pt-AO', 'pt-PT'],
    ['de-AT', 'de'],
  ])('maps %s to %s', (tag, expected) => {
    expect(mapLocaleToLanguage(tag)).toBe(expected)
  })

  it('returns null for unsupported or empty tags', () => {
    expect(mapLocaleToLanguage('sw-KE')).toBeNull()
    expect(mapLocaleToLanguage('')).toBeNull()
  })
})

describe('resolveDefaultLanguages', () => {
  it.each([
    [['ja-JP'], 'en', { primary: 'ja', secondary: 'en' }],
    [['ko-KR', 'en-US'], 'en', { primary: 'ko', secondary: 'en' }],
    [['zh-Hant-TW', 'en'], 'zh-CN', { primary: 'zh-Hant', secondary: 'en' }],
    [['en-US', 'es-MX'], 'en', { primary: 'en', secondary: 'es' }],
    [['en-US'], 'en', { primary: 'en', secondary: null }],
    [['en-US', 'en-GB'], 'en', { primary: 'en', secondary: null }],
    [['sw-KE', 'fr-FR'], 'en', { primary: 'fr', secondary: 'en' }],
  ])('resolves %j (UI %s)', (locales, ui, expected) => {
    expect(resolveDefaultLanguages(locales, ui)).toEqual(expected)
  })

  it('falls back to the UI language only when the system list is unusable', () => {
    expect(resolveDefaultLanguages([], 'zh-CN')).toEqual({ primary: 'zh-Hans', secondary: 'en' })
    expect(resolveDefaultLanguages(['sw-KE'], 'en')).toEqual({ primary: 'en', secondary: null })
  })
})
