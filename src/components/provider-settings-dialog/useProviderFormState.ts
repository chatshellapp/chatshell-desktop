import * as React from 'react'
import type { LLMProvider } from './types'
import { isCustomProvider } from './types'
import { BUILTIN_PROVIDERS } from './constants'

export interface UseProviderFormStateReturn {
  selectedProvider: LLMProvider
  setSelectedProvider: (provider: LLMProvider) => void
  apiKey: string
  setApiKey: (key: string) => void
  showApiKey: boolean
  setShowApiKey: (show: boolean) => void
  apiBaseUrl: string
  setApiBaseUrl: (url: string) => void
  providerName: string
  setProviderName: (name: string) => void
  apiStyle: string
  setApiStyle: (style: string) => void
  compatibilityType: string
  setCompatibilityType: (type: string) => void
  editingCustomProviderId: string | null
  setEditingCustomProviderId: (id: string | null) => void
}

/**
 * Manages basic form state for provider settings
 */
export function useProviderFormState(): UseProviderFormStateReturn {
  const [selectedProvider, setSelectedProvider] = React.useState<LLMProvider>(BUILTIN_PROVIDERS[0])
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [apiBaseUrl, setApiBaseUrl] = React.useState(BUILTIN_PROVIDERS[0].baseUrl)
  const [providerName, setProviderName] = React.useState('')
  const [apiStyle, setApiStyle] = React.useState('chat_completions')
  const [compatibilityType, setCompatibilityType] = React.useState('openai')
  const [editingCustomProviderId, setEditingCustomProviderId] = React.useState<string | null>(null)

  // Update base URL when provider changes (only for non-custom providers)
  React.useEffect(() => {
    if (!isCustomProvider(selectedProvider)) {
      setApiBaseUrl(selectedProvider.baseUrl)
    }
  }, [selectedProvider])

  return {
    selectedProvider,
    setSelectedProvider,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    providerName,
    setProviderName,
    apiStyle,
    setApiStyle,
    compatibilityType,
    setCompatibilityType,
    editingCustomProviderId,
    setEditingCustomProviderId,
  }
}
