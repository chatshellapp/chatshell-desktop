'use client'

import * as React from 'react'
import type { UseProviderSettingsReturn, ModelItem } from './types'
import { isCustomProviderType } from './types'
import { useProviderFormState } from './useProviderFormState'
import { useProviderData } from './useProviderData'
import { useModelList } from './useModelList'
import { useFetchModels } from './useFetchModels'
import { useModelFiltering } from './useModelFiltering'
import { useProviderSave } from './useProviderSave'

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

  // Wrap setSelectedProvider to handle custom provider editing
  const handleSelectProvider = React.useCallback(
    (provider: typeof formState.selectedProvider) => {
      if (isCustomProviderType(provider.id) && !provider.isCustom) {
        formState.setEditingCustomProviderId(null)
      }
      formState.setSelectedProvider(provider)
    },
    [formState]
  )

  // 2. Model list management
  const modelList = useModelList()

  // 3. Provider data loading
  const providerData = useProviderData({
    open,
    selectedProvider: formState.selectedProvider,
    editingCustomProviderId: formState.editingCustomProviderId,
    setApiKey: formState.setApiKey,
    setApiBaseUrl: formState.setApiBaseUrl,
    setProviderName: formState.setProviderName,
    setApiStyle: formState.setApiStyle,
    setCompatibilityType: formState.setCompatibilityType,
    setModels: modelList.setModels,
    setOriginalModelNames: modelList.setOriginalModelNames,
    setOriginalModelIds: modelList.setOriginalModelIds,
    setModelsToDelete: modelList.setModelsToDelete,
  })

  // 4. Fetch models from APIs
  const fetchModels = useFetchModels({
    selectedProvider: formState.selectedProvider,
    apiKey: formState.apiKey,
    apiBaseUrl: formState.apiBaseUrl,
    compatibilityType: formState.compatibilityType,
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
    originalModelIds: modelList.originalModelIds,
    existingProvider: providerData.existingProvider,
    apiKey: formState.apiKey,
    apiBaseUrl: formState.apiBaseUrl,
    providerName: formState.providerName,
    apiStyle: formState.apiStyle,
    compatibilityType: formState.compatibilityType,
    selectedProvider: formState.selectedProvider,
    loadExistingData: providerData.loadExistingData,
    onOpenChange,
  })

  // 7. Manual add model dialog state
  const [addModelDialogOpen, setAddModelDialogOpen] = React.useState(false)

  // 8. Edit model dialog state
  const [editModelDialogOpen, setEditModelDialogOpen] = React.useState(false)
  const [editingModel, setEditingModel] = React.useState<ModelItem | null>(null)

  const handleModelSettings = React.useCallback((model: ModelItem) => {
    setEditingModel(model)
    setEditModelDialogOpen(true)
  }, [])

  const handleEditModelSave = React.useCallback(
    (id: string, newModelId: string, newDisplayName: string) => {
      modelList.setModels((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, modelId: newModelId, displayName: newDisplayName } : m
        )
      )
    },
    [modelList]
  )

  return {
    // Form state
    ...formState,
    setSelectedProvider: handleSelectProvider,

    // Model list
    models: modelList.models,
    setModels: modelList.setModels,
    modelsToDelete: modelList.modelsToDelete,
    setModelsToDelete: modelList.setModelsToDelete,
    originalModelNames: modelList.originalModelNames,
    originalModelIds: modelList.originalModelIds,

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

    // Manual add model dialog
    addModelDialogOpen,
    setAddModelDialogOpen,

    // Edit model dialog
    editModelDialogOpen,
    setEditModelDialogOpen,
    editingModel,
    handleEditModelSave,

    // Handlers
    handleUpdateModelName: modelList.handleUpdateModelName,
    handleDeleteModel: modelList.handleDeleteModel,
    handleModelSettings,
    handleFetchModels: fetchModels.handleFetchModels,
    handleOpenFetchModal: fetchModels.handleOpenFetchModal,
    handleToggleImportModel: modelList.handleToggleImportModel,
    handleAddManualModel: modelList.handleAddManualModel,
    isModelImported: modelList.isModelImported,
    handleSave: save.handleSave,

    // Computed
    filteredModels: filtering.filteredModels,
    groupedModels: filtering.groupedModels,
  }
}
