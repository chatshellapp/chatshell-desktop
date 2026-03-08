import type en_common from '@/locales/en/common.json'
import type en_chat from '@/locales/en/chat.json'
import type en_settings from '@/locales/en/settings.json'
import type en_providers from '@/locales/en/providers.json'
import type en_sidebar from '@/locales/en/sidebar.json'
import type en_onboarding from '@/locales/en/onboarding.json'
import type en_assistants from '@/locales/en/assistants.json'
import type en_tools from '@/locales/en/tools.json'
import type en_prompts from '@/locales/en/prompts.json'
import type en_attachments from '@/locales/en/attachments.json'
import type en_messages from '@/locales/en/messages.json'

export type Namespace = keyof typeof import('@/locales/en/common.json')

export type DefaultNamespace = typeof import('@/locales/en/common.json')

export type CustomTypeOptions = {
  defaultNS: 'common'
  resources: {
    common: typeof en_common
    chat: typeof en_chat
    settings: typeof en_settings
    providers: typeof en_providers
    sidebar: typeof en_sidebar
    onboarding: typeof en_onboarding
    assistants: typeof en_assistants
    tools: typeof en_tools
    prompts: typeof en_prompts
    attachments: typeof en_attachments
    messages: typeof en_messages
  }
}
