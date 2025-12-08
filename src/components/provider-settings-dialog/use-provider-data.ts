import * as React from 'react'
import { useModelStore } from '@/stores/modelStore'
import type { Provider } from '@/types'
import type { LLMProvider, ModelItem } from './types'

export interface UseProviderDataReturn {
  existingProvider: Provider | null
  storeProviders: Provider[]
  isDataLoaded: boolean
  loadExistingData: () => void
}

interface UseProviderDataParams {
  open: boolean
  selectedProvider: LLMProvider
  setApiKey: (key: string) => void
  setApiBaseUrl: (url: string) => void
  setModels: React.Dispatch<React.SetStateAction<ModelItem[]>>
  setOriginalModelNames: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setModelsToDelete: React.Dispatch<React.SetStateAction<string[]>>
}

/**
 * Loads and manages existing provider data from the store
 */
export function useProviderData({
  open,
  selectedProvider,
  setApiKey,
  setApiBaseUrl,
  setModels,
  setOriginalModelNames,
  setModelsToDelete,
}: UseProviderDataParams): UseProviderDataReturn {
  const loadAll = useModelStore((state) => state.loadAll)
  const storeProviders = useModelStore((state) => state.providers)
  const storeModels = useModelStore((state) => state.models)
  const [isDataLoaded, setIsDataLoaded] = React.useState(false)
  const [existingProvider, setExistingProvider] = React.useState<Provider | null>(null)

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
    if (!isDataLoaded) return

    // Reset tracking state
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
          id: m.id,
          displayName: m.name,
          modelId: m.model_id,
          isExisting: true,
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
  }, [
    selectedProvider,
    storeProviders,
    storeModels,
    isDataLoaded,
    setApiKey,
    setApiBaseUrl,
    setModels,
    setOriginalModelNames,
    setModelsToDelete,
  ])

  const loadExistingData = React.useCallback(() => {
    loadAll().then(() => setIsDataLoaded(true))
  }, [loadAll])

  return {
    existingProvider,
    storeProviders,
    isDataLoaded,
    loadExistingData,
  }
}
