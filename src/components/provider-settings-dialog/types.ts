import type { LucideIcon } from 'lucide-react'
import type { Provider } from '@/types'

export interface ProviderSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

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
  icon: LucideIcon
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

