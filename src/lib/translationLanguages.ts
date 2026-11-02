/**
 * Language catalog and locale helpers for the translation page.
 *
 * Translation languages are independent of the UI language: the UI only ships
 * a couple of locales, while users translate between any of the languages
 * below. Display and native names are generated with `Intl.DisplayNames` so no
 * localized names are hard-coded here.
 */

export const AUTO_LANGUAGE = 'auto'

export interface TranslationLanguage {
  code: string
  /** English name, used in prompts and as the display fallback. */
  englishName: string
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'ar', englishName: 'Arabic' },
  { code: 'zh-Hans', englishName: 'Chinese (Simplified)' },
  { code: 'zh-Hant', englishName: 'Chinese (Traditional)' },
  { code: 'cs', englishName: 'Czech' },
  { code: 'da', englishName: 'Danish' },
  { code: 'nl', englishName: 'Dutch' },
  { code: 'en', englishName: 'English' },
  { code: 'fi', englishName: 'Finnish' },
  { code: 'fr', englishName: 'French' },
  { code: 'de', englishName: 'German' },
  { code: 'hi', englishName: 'Hindi' },
  { code: 'id', englishName: 'Indonesian' },
  { code: 'it', englishName: 'Italian' },
  { code: 'ja', englishName: 'Japanese' },
  { code: 'ko', englishName: 'Korean' },
  { code: 'pl', englishName: 'Polish' },
  { code: 'pt-BR', englishName: 'Portuguese (Brazil)' },
  { code: 'pt-PT', englishName: 'Portuguese (Portugal)' },
  { code: 'ru', englishName: 'Russian' },
  { code: 'es', englishName: 'Spanish' },
  { code: 'sv', englishName: 'Swedish' },
  { code: 'th', englishName: 'Thai' },
  { code: 'tr', englishName: 'Turkish' },
  { code: 'uk', englishName: 'Ukrainian' },
  { code: 'vi', englishName: 'Vietnamese' },
]

const ENGLISH_NAMES = new Map(TRANSLATION_LANGUAGES.map((l) => [l.code, l.englishName]))

export function isTranslationLanguage(code: string | null | undefined): code is string {
  return !!code && ENGLISH_NAMES.has(code)
}

export function getEnglishName(code: string): string {
  return ENGLISH_NAMES.get(code) ?? code
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>()

function getDisplayNames(locale: string): Intl.DisplayNames | null {
  if (!displayNamesCache.has(locale)) {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' })
    } catch {
      names = null
    }
    displayNamesCache.set(locale, names)
  }
  return displayNamesCache.get(locale) ?? null
}

/** Name of `code` in `uiLocale`, falling back to the English name. */
export function getDisplayName(code: string, uiLocale: string): string {
  try {
    return getDisplayNames(uiLocale)?.of(code) ?? getEnglishName(code)
  } catch {
    return getEnglishName(code)
  }
}

/** Name of `code` in that language itself, e.g. the endonym. */
export function getNativeName(code: string): string {
  return getDisplayName(code, code)
}

/** Compact label for narrow layouts, e.g. `KO` or `ZH-HANT`. */
export function getShortCode(code: string): string {
  return code.toUpperCase()
}

/**
 * Maps an OS or browser locale tag (BCP 47 or POSIX style) to a supported
 * translation language, or null when the language is not supported.
 */
export function mapLocaleToLanguage(tag: string): string | null {
  const cleaned = tag.split(/[.@]/)[0].replace(/_/g, '-').trim()
  if (!cleaned) return null
  const parts = cleaned.split('-').map((p) => p.toLowerCase())
  const language = parts[0]
  const subtags = parts.slice(1)

  if (language === 'zh') {
    if (subtags.includes('hant')) return 'zh-Hant'
    if (subtags.includes('hans')) return 'zh-Hans'
    return subtags.some((s) => s === 'tw' || s === 'hk' || s === 'mo') ? 'zh-Hant' : 'zh-Hans'
  }
  if (language === 'pt') {
    return subtags.includes('br') ? 'pt-BR' : 'pt-PT'
  }
  return isTranslationLanguage(language) ? language : null
}

export interface DefaultLanguages {
  primary: string
  secondary: string | null
}

/**
 * Derives default primary/secondary languages from the OS preferred-language
 * list. The UI language is only used when the OS list yields nothing usable.
 */
export function resolveDefaultLanguages(
  systemLocales: readonly string[],
  uiLocale: string
): DefaultLanguages {
  const mapped: string[] = []
  for (const tag of systemLocales) {
    const code = mapLocaleToLanguage(tag)
    if (code && !mapped.includes(code)) mapped.push(code)
  }
  if (mapped.length === 0) mapped.push(mapLocaleToLanguage(uiLocale) ?? 'en')

  const primary = mapped[0]
  const secondary = mapped.find((code) => code !== primary) ?? (primary !== 'en' ? 'en' : null)
  return { primary, secondary }
}
