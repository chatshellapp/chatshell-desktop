'use client'

import * as React from 'react'
import type { UseProviderSettingsReturn, ModelItem } from './types'
import { useProviderFormState } from './use-provider-form-state'
import { useProviderData } from './use-provider-data'
import { useModelList } from './use-model-list'
import { useFetchModels } from './use-fetch-models'
import { useModelFiltering } from './use-model-filtering'
import { useProviderSave } from './use-provider-save'
import { logger } from '@/lib/logger'

/**
 * Main hook that composes all provider settings functionality
 * This hook orchestrates the smaller, focused hooks to provide
 * a complete API for the provider settings dialog
 */
export function useProviderSettings(
  open: boolean,
  onOpenChange: (open: boolean) => void
): UseProviderSettingsReturn {
  // 1. Form state management
  const formState = useProviderFormState()

  // 2. Model list management
  const modelList = useModelList()

  // 3. Provider data loading
  const providerData = useProviderData({
    open,
    selectedProvider: formState.selectedProvider,
    setApiKey: formState.setApiKey,
    setApiBaseUrl: formState.setApiBaseUrl,
    setModels: modelList.setModels,
    setOriginalModelNames: modelList.setOriginalModelNames,
    setModelsToDelete: modelList.setModelsToDelete,
  })

  // 4. Fetch models from APIs
  const fetchModels = useFetchModels({
    selectedProvider: formState.selectedProvider,
    apiKey: formState.apiKey,
    apiBaseUrl: formState.apiBaseUrl,
  })

  // 5. Model filtering and grouping
  const filtering = useModelFiltering({
    availableModels: fetchModels.availableModels,
    modelSearchQuery: fetchModels.modelSearchQuery,
    selectedProvider: formState.selectedProvider,
  })

  // 6. Save functionality
  const save = useProviderSave({
    models: modelList.models,
    modelsToDelete: modelList.modelsToDelete,
    originalModelNames: modelList.originalModelNames,
    existingProvider: providerData.existingProvider,
    apiKey: formState.apiKey,
    apiBaseUrl: formState.apiBaseUrl,
    selectedProvider: formState.selectedProvider,
    loadExistingData: providerData.loadExistingData,
    onOpenChange,
  })

  // Additional handler for model settings (placeholder)
  const handleModelSettings = React.useCallback((model: ModelItem) => {
    logger.info('Model settings:', model)
    // Add your model settings logic here
  }, [])

  // Compose and return the complete API
  return {
    // Form state
    ...formState,

    // Model list
    models: modelList.models,
    setModels: modelList.setModels,
    modelsToDelete: modelList.modelsToDelete,
    setModelsToDelete: modelList.setModelsToDelete,
    originalModelNames: modelList.originalModelNames,

    // Provider data
    existingProvider: providerData.existingProvider,
    storeProviders: providerData.storeProviders,
    isDataLoaded: providerData.isDataLoaded,

    // Fetch models
    fetchModalOpen: fetchModels.fetchModalOpen,
    setFetchModalOpen: fetchModels.setFetchModalOpen,
    availableModels: fetchModels.availableModels,
    isLoading: fetchModels.isLoading,
    fetchError: fetchModels.fetchError,
    modelSearchQuery: fetchModels.modelSearchQuery,
    setModelSearchQuery: fetchModels.setModelSearchQuery,

    // Save
    isSaving: save.isSaving,

    // Handlers
    handleUpdateModelName: modelList.handleUpdateModelName,
    handleDeleteModel: modelList.handleDeleteModel,
    handleModelSettings,
    handleFetchModels: fetchModels.handleFetchModels,
    handleOpenFetchModal: fetchModels.handleOpenFetchModal,
    handleToggleImportModel: modelList.handleToggleImportModel,
    isModelImported: modelList.isModelImported,
    handleSave: save.handleSave,

    // Computed
    filteredModels: filtering.filteredModels,
    groupedModels: filtering.groupedModels,
  }
}
