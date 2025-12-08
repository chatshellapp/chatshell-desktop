import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { CreateProviderRequest, CreateModelRequest, Provider } from '@/types'
import type { LLMProvider, ModelItem } from './types'
import { logger } from '@/lib/logger'

export interface UseProviderSaveReturn {
  isSaving: boolean
  handleSave: () => Promise<void>
}

interface UseProviderSaveParams {
  models: ModelItem[]
  modelsToDelete: string[]
  originalModelNames: Record<string, string>
  existingProvider: Provider | null
  apiKey: string
  apiBaseUrl: string
  selectedProvider: LLMProvider
  loadExistingData: () => void
  onOpenChange: (open: boolean) => void
}

/**
 * Handles saving provider and model changes to the backend
 */
export function useProviderSave({
  models,
  modelsToDelete,
  originalModelNames,
  existingProvider,
  apiKey,
  apiBaseUrl,
  selectedProvider,
  loadExistingData,
  onOpenChange,
}: UseProviderSaveParams): UseProviderSaveReturn {
  const [isSaving, setIsSaving] = React.useState(false)

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
      logger.warn('No changes to save')
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
          logger.info('Updated provider:', existingProvider.name)
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
        logger.info('Created provider:', provider)
        providerId = provider.id
      }

      // Soft delete removed models
      for (const modelId of modelsToDelete) {
        await invoke('soft_delete_model', { id: modelId })
        logger.info('Soft deleted model:', modelId)
      }

      // Update existing models with changed names
      for (const model of modifiedModels) {
        const modelReq: CreateModelRequest = {
          name: model.displayName,
          provider_id: providerId,
          model_id: model.modelId,
          is_starred: false,
        }
        await invoke('update_model', { id: model.id, req: modelReq })
        logger.info('Updated model:', model.id, 'with new name:', model.displayName)
      }

      // Create only new models
      for (const model of newModels) {
        const modelReq: CreateModelRequest = {
          name: model.displayName,
          provider_id: providerId,
          model_id: model.modelId,
          is_starred: false,
        }
        await invoke('create_model', { req: modelReq })
        logger.info('Created model:', model.displayName, 'with ID:', model.modelId)
      }

      // Refresh the model store to show new models in sidebar
      loadExistingData()

      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to save provider:', error)
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
    loadExistingData,
    onOpenChange,
  ])

  return {
    isSaving,
    handleSave,
  }
}
