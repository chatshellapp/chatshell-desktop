import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import common_en from '@/locales/en/common.json'
import common_zhCN from '@/locales/zh-CN/common.json'
import chat_en from '@/locales/en/chat.json'
import chat_zhCN from '@/locales/zh-CN/chat.json'
import settings_en from '@/locales/en/settings.json'
import settings_zhCN from '@/locales/zh-CN/settings.json'
import providers_en from '@/locales/en/providers.json'
import providers_zhCN from '@/locales/zh-CN/providers.json'
import sidebar_en from '@/locales/en/sidebar.json'
import sidebar_zhCN from '@/locales/zh-CN/sidebar.json'
import onboarding_en from '@/locales/en/onboarding.json'
import onboarding_zhCN from '@/locales/zh-CN/onboarding.json'
import assistants_en from '@/locales/en/assistants.json'
import assistants_zhCN from '@/locales/zh-CN/assistants.json'
import tools_en from '@/locales/en/tools.json'
import tools_zhCN from '@/locales/zh-CN/tools.json'
import prompts_en from '@/locales/en/prompts.json'
import prompts_zhCN from '@/locales/zh-CN/prompts.json'
import attachments_en from '@/locales/en/attachments.json'
import attachments_zhCN from '@/locales/zh-CN/attachments.json'
import messages_en from '@/locales/en/messages.json'
import messages_zhCN from '@/locales/zh-CN/messages.json'
import search_en from '@/locales/en/search.json'
import search_zhCN from '@/locales/zh-CN/search.json'

const LANGUAGE_KEY = 'chatshell_language'

export const supportedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '简体中文' },
] as const

export type SupportedLanguage = (typeof supportedLanguages)[number]['code']

const resources = {
  en: {
    common: common_en,
    chat: chat_en,
    settings: settings_en,
    providers: providers_en,
    sidebar: sidebar_en,
    onboarding: onboarding_en,
    assistants: assistants_en,
    tools: tools_en,
    prompts: prompts_en,
    attachments: attachments_en,
    messages: messages_en,
    search: search_en,
  },
  'zh-CN': {
    common: common_zhCN,
    chat: chat_zhCN,
    settings: settings_zhCN,
    providers: providers_zhCN,
    sidebar: sidebar_zhCN,
    onboarding: onboarding_zhCN,
    assistants: assistants_zhCN,
    tools: tools_zhCN,
    prompts: prompts_zhCN,
    attachments: attachments_zhCN,
    messages: messages_zhCN,
    search: search_zhCN,
  },
}

const languageDetector = {
  type: 'languageDetector' as const,
  async: true,
  detect: (callback: (lng: string) => void) => {
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY)
    if (savedLanguage && supportedLanguages.some((l) => l.code === savedLanguage)) {
      callback(savedLanguage)
      return
    }
    const browserLanguage = navigator.language
    if (browserLanguage.startsWith('zh')) {
      callback('zh-CN')
    } else {
      callback('en')
    }
  },
  init: () => {},
  cacheUserLanguage: (lng: string) => {
    localStorage.setItem(LANGUAGE_KEY, lng)
  },
}

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common',
      'chat',
      'settings',
      'providers',
      'sidebar',
      'onboarding',
      'assistants',
      'tools',
      'prompts',
      'attachments',
      'messages',
      'search',
    ],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  })

export default i18n

export const changeLanguage = async (language: SupportedLanguage) => {
  await i18n.changeLanguage(language)
  localStorage.setItem(LANGUAGE_KEY, language)
}

export const getCurrentLanguage = (): SupportedLanguage => {
  return i18n.language as SupportedLanguage
}
