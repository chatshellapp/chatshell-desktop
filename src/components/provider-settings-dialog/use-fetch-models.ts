import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { LLMProvider, ModelInfo } from './types'
import { logger } from '@/lib/logger'

export interface UseFetchModelsReturn {
  availableModels: ModelInfo[]
  isLoading: boolean
  fetchError: string | null
  fetchModalOpen: boolean
  setFetchModalOpen: (open: boolean) => void
  modelSearchQuery: string
  setModelSearchQuery: (query: string) => void
  handleFetchModels: () => Promise<void>
  handleOpenFetchModal: () => void
}

interface UseFetchModelsParams {
  selectedProvider: LLMProvider
  apiKey: string
  apiBaseUrl: string
}

/**
 * Handles fetching models from external APIs (OpenAI, OpenRouter, Ollama)
 */
export function useFetchModels({
  selectedProvider,
  apiKey,
  apiBaseUrl,
}: UseFetchModelsParams): UseFetchModelsReturn {
  const [availableModels, setAvailableModels] = React.useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [fetchError, setFetchError] = React.useState<string | null>(null)
  const [fetchModalOpen, setFetchModalOpen] = React.useState(false)
  const [modelSearchQuery, setModelSearchQuery] = React.useState('')

  const handleFetchModels = React.useCallback(async () => {
    setIsLoading(true)
    setFetchError(null)
    setAvailableModels([])

    try {
      const providerId = selectedProvider.id
      let fetchedModels: ModelInfo[] = []

      if (providerId === 'openai') {
        if (!apiKey) {
          throw new Error('OpenAI API key is required. Please enter your API key above.')
        }
        fetchedModels = await invoke<ModelInfo[]>('fetch_openai_models', { apiKey })
      } else if (providerId === 'openrouter') {
        if (!apiKey) {
          throw new Error('OpenRouter API key is required. Please enter your API key above.')
        }
        fetchedModels = await invoke<ModelInfo[]>('fetch_openrouter_models', { apiKey })
      } else if (providerId === 'ollama') {
        const baseUrl = apiBaseUrl || 'http://localhost:11434'
        fetchedModels = await invoke<ModelInfo[]>('fetch_ollama_models', { baseUrl })
      } else {
        throw new Error(
          `Model fetching is not yet supported for ${selectedProvider.name}. Please add models manually.`
        )
      }

      setAvailableModels(fetchedModels)
    } catch (error) {
      logger.error('Error fetching models:', error)
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch models')
    } finally {
      setIsLoading(false)
    }
  }, [selectedProvider, apiKey, apiBaseUrl])

  const handleOpenFetchModal = React.useCallback(() => {
    setModelSearchQuery('')
    setFetchModalOpen(true)
    handleFetchModels()
  }, [handleFetchModels])

  return {
    availableModels,
    isLoading,
    fetchError,
    fetchModalOpen,
    setFetchModalOpen,
    modelSearchQuery,
    setModelSearchQuery,
    handleFetchModels,
    handleOpenFetchModal,
  }
}
