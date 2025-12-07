'use client'

import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useModelStore } from '@/stores/modelStore'
import type { CreateProviderRequest, CreateModelRequest, Provider } from '@/types'
import type { ModelItem, ModelInfo, LLMProvider, UseProviderSettingsReturn } from './types'
import { llmProviders } from './constants'

export function useProviderSettings(
  open: boolean,
  onOpenChange: (open: boolean) => void
): UseProviderSettingsReturn {
  const [selectedProvider, setSelectedProvider] = React.useState<LLMProvider>(llmProviders[0])
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [apiBaseUrl, setApiBaseUrl] = React.useState(llmProviders[0].baseUrl)
  const [models, setModels] = React.useState<ModelItem[]>([])
  const [fetchModalOpen, setFetchModalOpen] = React.useState(false)
  const [availableModels, setAvailableModels] = React.useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [fetchError, setFetchError] = React.useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = React.useState('')
  const [isSaving, setIsSaving] = React.useState(false)
  const [existingProvider, setExistingProvider] = React.useState<Provider | null>(null)
  const [modelsToDelete, setModelsToDelete] = React.useState<string[]>([])
  const [originalModelNames, setOriginalModelNames] = React.useState<Record<string, string>>({})

  // Store hooks
  const loadAll = useModelStore((state) => state.loadAll)
  const storeProviders = useModelStore((state) => state.providers)
  const storeModels = useModelStore((state) => state.models)
  const [isDataLoaded, setIsDataLoaded] = React.useState(false)

  // Load data when dialog opens
  React.useEffect(() => {
    if (open) {
      setIsDataLoaded(false)
      loadAll().then(() => setIsDataLoaded(true))
    } else {
      setIsDataLoaded(false)
    }
  }, [open, loadAll])

  // Load existing provider data when provider type changes OR data is loaded
  React.useEffect(() => {
    if (!isDataLoaded) return // Don't populate until data is loaded

    // Reset modelsToDelete and originalModelNames when switching providers
    setModelsToDelete([])
    setOriginalModelNames({})

    // Find existing provider of the selected type
    const existing = storeProviders.find((p) => p.provider_type === selectedProvider.id)
    setExistingProvider(existing || null)

    if (existing) {
      // Load existing provider's data
      setApiKey(existing.api_key || '')
      setApiBaseUrl(existing.base_url || selectedProvider.baseUrl)

      // Load existing models for this provider
      const existingModels = storeModels
        .filter((m) => m.provider_id === existing.id)
        .map((m) => ({
          id: m.id, // Use the database ID
          displayName: m.name, // Human-friendly display name
          modelId: m.model_id, // Raw model identifier for API calls
          isExisting: true, // Mark as existing
        }))
      setModels(existingModels)

      // Store original names to track changes
      const nameMap: Record<string, string> = {}
      existingModels.forEach((m) => {
        nameMap[m.id] = m.displayName
      })
      setOriginalModelNames(nameMap)
    } else {
      // Reset to defaults for new provider
      setApiKey('')
      setApiBaseUrl(selectedProvider.baseUrl)
      setModels([])
    }
  }, [selectedProvider, storeProviders, storeModels, isDataLoaded])

  const handleUpdateModelName = React.useCallback((id: string, newDisplayName: string) => {
    setModels((prev) =>
      prev.map((model) => (model.id === id ? { ...model, displayName: newDisplayName } : model))
    )
  }, [])

  const handleDeleteModel = React.useCallback((id: string) => {
    setModels((prev) => prev.filter((model) => model.id !== id))
  }, [])

  const handleModelSettings = React.useCallback((model: ModelItem) => {
    console.log('Model settings:', model)
    // Add your model settings logic here
  }, [])

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
      console.error('Error fetching models:', error)
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

  const handleToggleImportModel = React.useCallback(
    (model: ModelInfo) => {
      setModels((prevModels) => {
        const existingIndex = prevModels.findIndex((m) => m.modelId === model.id)
        if (existingIndex >= 0) {
          // Model is currently in list - remove it
          const existingModel = prevModels[existingIndex]
          if (existingModel.isExisting) {
            // Mark for soft delete
            setModelsToDelete((prev) => [...prev, existingModel.id])
          }
          return prevModels.filter((_, idx) => idx !== existingIndex)
        } else {
          // Model not in list - check if it was marked for deletion and restore it
          const markedForDelete = modelsToDelete.find((id) => {
            const m = storeModels.find((sm) => sm.id === id)
            return m && m.model_id === model.id
          })

          if (markedForDelete) {
            // Restore from delete list
            const originalModel = storeModels.find((sm) => sm.id === markedForDelete)
            setModelsToDelete((prev) => prev.filter((id) => id !== markedForDelete))
            if (originalModel) {
              return [
                ...prevModels,
                {
                  id: originalModel.id,
                  displayName: originalModel.name,
                  modelId: originalModel.model_id,
                  isExisting: true,
                },
              ]
            }
          }

          // Add as new model - use processed name from API, raw ID for API calls
          return [
            ...prevModels,
            {
              id: Date.now().toString(),
              displayName: model.name, // Human-friendly display name from API
              modelId: model.id, // Raw model identifier for API calls
            },
          ]
        }
      })
    },
    [modelsToDelete, storeModels]
  )

  const isModelImported = React.useCallback(
    (rawModelId: string) => {
      return models.some((m) => m.modelId === rawModelId)
    },
    [models]
  )

  const handleSave = React.useCallback(async () => {
    // Filter for new models only
    const newModels = models.filter((m) => !m.isExisting)

    // Find existing models with changed names
    const modifiedModels = models.filter(
      (m) => m.isExisting && originalModelNames[m.id] && originalModelNames[m.id] !== m.displayName
    )

    if (
      newModels.length === 0 &&
      modelsToDelete.length === 0 &&
      modifiedModels.length === 0 &&
      !existingProvider
    ) {
      console.warn('No changes to save')
      onOpenChange(false)
      return
    }

    setIsSaving(true)
    try {
      let providerId: string

      if (existingProvider) {
        // Update existing provider's API key and base URL if changed
        if (existingProvider.api_key !== apiKey || existingProvider.base_url !== apiBaseUrl) {
          await invoke('update_provider', {
            id: existingProvider.id,
            req: {
              name: existingProvider.name,
              provider_type: existingProvider.provider_type,
              api_key: apiKey || undefined,
              base_url: apiBaseUrl || undefined,
              is_enabled: existingProvider.is_enabled,
            },
          })
          console.log('Updated provider:', existingProvider.name)
        }
        providerId = existingProvider.id
      } else {
        // Create new provider
        const providerReq: CreateProviderRequest = {
          name: selectedProvider.name,
          provider_type: selectedProvider.id,
          api_key: apiKey || undefined,
          base_url: apiBaseUrl || undefined,
          is_enabled: true,
        }

        const provider = await invoke<Provider>('create_provider', { req: providerReq })
        console.log('Created provider:', provider)
        providerId = provider.id
      }

      // Soft delete removed models
      for (const modelId of modelsToDelete) {
        await invoke('soft_delete_model', { id: modelId })
        console.log('Soft deleted model:', modelId)
      }

      // Update existing models with changed names
      for (const model of modifiedModels) {
        const modelReq: CreateModelRequest = {
          name: model.displayName,
          provider_id: providerId,
          model_id: model.modelId,
          is_starred: false, // Preserve starred status would require loading from store
        }
        await invoke('update_model', { id: model.id, req: modelReq })
        console.log('Updated model:', model.id, 'with new name:', model.displayName)
      }

      // Create only new models
      for (const model of newModels) {
        const modelReq: CreateModelRequest = {
          name: model.displayName, // Human-friendly display name
          provider_id: providerId,
          model_id: model.modelId, // Raw model identifier for API calls
          is_starred: false,
        }
        await invoke('create_model', { req: modelReq })
        console.log('Created model:', model.displayName, 'with ID:', model.modelId)
      }

      // Refresh the model store to show new models in sidebar
      await loadAll()

      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save provider:', error)
      // TODO: Show error toast
    } finally {
      setIsSaving(false)
    }
  }, [
    models,
    modelsToDelete,
    originalModelNames,
    existingProvider,
    apiKey,
    apiBaseUrl,
    selectedProvider,
    loadAll,
    onOpenChange,
  ])

  // Filter models by search query
  const filteredModels = React.useMemo(() => {
    if (!modelSearchQuery.trim()) {
      return availableModels
    }
    const query = modelSearchQuery.toLowerCase()
    return availableModels.filter(
      (model) =>
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query) ||
        model.description?.toLowerCase().includes(query)
    )
  }, [availableModels, modelSearchQuery])

  // Group models by vendor/family
  const groupedModels = React.useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {}
    filteredModels.forEach((model) => {
      let groupName: string

      if (selectedProvider.id === 'openrouter') {
        // For OpenRouter, group by vendor prefix (e.g., "anthropic/claude-3" -> "anthropic")
        const slashIndex = model.id.indexOf('/')
        groupName = slashIndex > 0 ? model.id.substring(0, slashIndex) : 'Other'
        // Capitalize first letter
        groupName = groupName.charAt(0).toUpperCase() + groupName.slice(1)
      } else {
        // For other providers, use a single group
        groupName = selectedProvider.name
      }

      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push(model)
    })

    // Sort groups alphabetically
    const sortedGroups: Record<string, ModelInfo[]> = {}
    Object.keys(groups)
      .sort()
      .forEach((key) => {
        sortedGroups[key] = groups[key]
      })

    return sortedGroups
  }, [filteredModels, selectedProvider])

  return {
    // State
    selectedProvider,
    setSelectedProvider,
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    models,
    setModels,
    fetchModalOpen,
    setFetchModalOpen,
    availableModels,
    isLoading,
    fetchError,
    modelSearchQuery,
    setModelSearchQuery,
    isSaving,
    existingProvider,
    modelsToDelete,
    setModelsToDelete,
    originalModelNames,
    storeProviders,
    isDataLoaded,

    // Handlers
    handleUpdateModelName,
    handleDeleteModel,
    handleModelSettings,
    handleFetchModels,
    handleOpenFetchModal,
    handleToggleImportModel,
    isModelImported,
    handleSave,

    // Computed
    filteredModels,
    groupedModels,
  }
}

