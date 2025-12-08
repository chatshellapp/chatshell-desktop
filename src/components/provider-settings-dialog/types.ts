import type { Provider } from '@/types'

export interface ProviderSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Re-export hook return types for external use
export type { UseProviderFormStateReturn } from './use-provider-form-state'
export type { UseProviderDataReturn } from './use-provider-data'
export type { UseModelListReturn } from './use-model-list'
export type { UseFetchModelsReturn } from './use-fetch-models'
export type { UseModelFilteringReturn } from './use-model-filtering'
export type { UseProviderSaveReturn } from './use-provider-save'

export interface ModelItem {
  id: string
  displayName: string // Human-friendly display name
  modelId: string // Raw model identifier for API calls
  isExisting?: boolean // true if already saved in database
}

// ModelInfo from Tauri backend
export interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
  pricing?: {
    prompt?: number
    completion?: number
  }
}

export interface LLMProvider {
  id: string
  name: string
  logo: string
  baseUrl: string
}

export interface UseProviderSettingsReturn {
  // State
  selectedProvider: LLMProvider
  setSelectedProvider: (provider: LLMProvider) => void
  apiKey: string
  setApiKey: (key: string) => void
  showApiKey: boolean
  setShowApiKey: (show: boolean) => void
  apiBaseUrl: string
  setApiBaseUrl: (url: string) => void
  models: ModelItem[]
  setModels: React.Dispatch<React.SetStateAction<ModelItem[]>>
  fetchModalOpen: boolean
  setFetchModalOpen: (open: boolean) => void
  availableModels: ModelInfo[]
  isLoading: boolean
  fetchError: string | null
  modelSearchQuery: string
  setModelSearchQuery: (query: string) => void
  isSaving: boolean
  existingProvider: Provider | null
  modelsToDelete: string[]
  setModelsToDelete: React.Dispatch<React.SetStateAction<string[]>>
  originalModelNames: Record<string, string>
  storeProviders: Provider[]
  isDataLoaded: boolean

  // Handlers
  handleUpdateModelName: (id: string, newDisplayName: string) => void
  handleDeleteModel: (id: string) => void
  handleModelSettings: (model: ModelItem) => void
  handleFetchModels: () => Promise<void>
  handleOpenFetchModal: () => void
  handleToggleImportModel: (model: ModelInfo) => void
  isModelImported: (rawModelId: string) => boolean
  handleSave: () => Promise<void>

  // Computed
  filteredModels: ModelInfo[]
  groupedModels: Record<string, ModelInfo[]>
}
