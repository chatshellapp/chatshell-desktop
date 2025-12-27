import * as React from 'react'
import type { LLMProvider } from './types'
import { LLM_PROVIDERS } from './constants'

export interface UseProviderFormStateReturn {
  selectedProvider: LLMProvider
  setSelectedProvider: (provider: LLMProvider) => void
  apiKey: string
  setApiKey: (key: string) => void
  showApiKey: boolean
  setShowApiKey: (show: boolean) => void
  apiBaseUrl: string
  setApiBaseUrl: (url: string) => void
}

/**
 * Manages basic form state for provider settings
 */
export function useProviderFormState(): UseProviderFormStateReturn {
  const [selectedProvider, setSelectedProvider] = React.useState<LLMProvider>(LLM_PROVIDERS[0])
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [apiBaseUrl, setApiBaseUrl] = React.useState(LLM_PROVIDERS[0].baseUrl)

  // Update base URL when provider changes
  React.useEffect(() => {
    setApiBaseUrl(selectedProvider.baseUrl)
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
  }
}
