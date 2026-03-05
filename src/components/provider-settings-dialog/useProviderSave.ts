import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import type { CreateProviderRequest, CreateModelRequest, Provider } from '@/types'
import type { LLMProvider, ModelItem } from './types'
import { isCustomProvider } from './types'
import { logger } from '@/lib/logger'

export interface UseProviderSaveReturn {
  isSaving: boolean
  handleSave: () => Promise<void>
}

interface UseProviderSaveParams {
  models: ModelItem[]
  modelsToDelete: string[]
  originalModelNames: Record<string, string>
  originalModelIds: Record<string, string>
  existingProvider: Provider | null
  apiKey: string
  apiBaseUrl: string
  providerName: string
  apiStyle: string
  compatibilityType: string
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
  originalModelIds,
  existingProvider,
  apiKey,
  apiBaseUrl,
  providerName,
  apiStyle,
  compatibilityType,
  selectedProvider,
  loadExistingData,
  onOpenChange,
}: UseProviderSaveParams): UseProviderSaveReturn {
  const [isSaving, setIsSaving] = React.useState(false)

  const handleSave = React.useCallback(async () => {
    const newModels = models.filter((m) => !m.isExisting)
    const modifiedModels = models.filter(
      (m) =>
        m.isExisting &&
        (originalModelNames[m.id] !== m.displayName || originalModelIds[m.id] !== m.modelId)
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
      const isCustom = isCustomProvider(selectedProvider)
      const effectiveName = isCustom ? providerName || selectedProvider.name : selectedProvider.name
      const effectiveProviderType = isCustom
        ? compatibilityType === 'anthropic'
          ? 'custom_anthropic'
          : 'custom_openai'
        : selectedProvider.id
      const effectiveApiStyle = compatibilityType === 'openai' && isCustom ? apiStyle : undefined

      if (existingProvider) {
        const needsUpdate =
          existingProvider.api_key !== apiKey ||
          existingProvider.base_url !== apiBaseUrl ||
          existingProvider.name !== effectiveName ||
          existingProvider.provider_type !== effectiveProviderType ||
          existingProvider.api_style !== effectiveApiStyle

        if (needsUpdate) {
          await invoke('update_provider', {
            id: existingProvider.id,
            req: {
              name: effectiveName,
              provider_type: effectiveProviderType,
              api_key: apiKey || undefined,
              base_url: apiBaseUrl || undefined,
              api_style: effectiveApiStyle,
              is_enabled: existingProvider.is_enabled,
            },
          })
          logger.info('Updated provider:', effectiveName)
        }
        providerId = existingProvider.id
      } else {
        const providerReq: CreateProviderRequest = {
          name: effectiveName,
          provider_type: effectiveProviderType,
          api_key: apiKey || undefined,
          base_url: apiBaseUrl || undefined,
          api_style: effectiveApiStyle,
          is_enabled: true,
        }

        const provider = await invoke<Provider>('create_provider', { req: providerReq })
        logger.info('Created provider:', provider)
        providerId = provider.id
      }

      for (const modelId of modelsToDelete) {
        await invoke('soft_delete_model', { id: modelId })
        logger.info('Soft deleted model:', modelId)
      }

      for (const model of modifiedModels) {
        const modelReq: CreateModelRequest = {
          name: model.displayName,
          provider_id: providerId,
          model_id: model.modelId,
          is_starred: false,
        }
        await invoke('update_model', { id: model.id, req: modelReq })
        logger.info('Updated model', { id: model.id, newName: model.displayName })
      }

      for (const model of newModels) {
        const modelReq: CreateModelRequest = {
          name: model.displayName,
          provider_id: providerId,
          model_id: model.modelId,
          is_starred: false,
        }
        await invoke('create_model', { req: modelReq })
        logger.info('Created model', { name: model.displayName, id: model.modelId })
      }

      loadExistingData()
      onOpenChange(false)
    } catch (error) {
      logger.error('Failed to save provider:', error)
      toast.error('Failed to save provider settings', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsSaving(false)
    }
  }, [
    models,
    modelsToDelete,
    originalModelNames,
    originalModelIds,
    existingProvider,
    apiKey,
    apiBaseUrl,
    providerName,
    apiStyle,
    compatibilityType,
    selectedProvider,
    loadExistingData,
    onOpenChange,
  ])

  return {
    isSaving,
    handleSave,
  }
}
