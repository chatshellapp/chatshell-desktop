'use client'

import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Bot,
  Database,
  Server,
  Plus,
  MoreHorizontal,
  Download,
  Loader2,
  ChevronDown,
} from 'lucide-react'
import { useModelStore } from '@/stores/modelStore'
import type { CreateProviderRequest, CreateModelRequest, Provider } from '@/types'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const llmProviders = [
  { id: 'openai', name: 'OpenAI', icon: Bot },
  { id: 'anthropic', name: 'Anthropic', icon: Bot },
  { id: 'google', name: 'Google AI', icon: Bot },
  { id: 'openrouter', name: 'OpenRouter', icon: Server },
  { id: 'ollama', name: 'Ollama', icon: Database },
  { id: 'azure', name: 'Azure OpenAI', icon: Bot },
  { id: 'cohere', name: 'Cohere', icon: Bot },
  { id: 'huggingface', name: 'Hugging Face', icon: Bot },
]

interface ProviderSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ModelItem {
  id: string
  name: string
  isExisting?: boolean // true if already saved in database
}

// ModelInfo from Tauri backend
interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
  pricing?: {
    prompt?: number
    completion?: number
  }
}

// Supported provider types for model fetching
const SUPPORTED_FETCH_PROVIDERS = ['openai', 'openrouter', 'ollama'] as const
type SupportedFetchProvider = (typeof SUPPORTED_FETCH_PROVIDERS)[number]

function isSupportedFetchProvider(id: string): id is SupportedFetchProvider {
  return SUPPORTED_FETCH_PROVIDERS.includes(id as SupportedFetchProvider)
}

export function ProviderSettingsDialog({ open, onOpenChange }: ProviderSettingsDialogProps) {
  const [selectedProvider, setSelectedProvider] = React.useState(llmProviders[0])
  const [apiKey, setApiKey] = React.useState('')
  const [apiBaseUrl, setApiBaseUrl] = React.useState('http://localhost:11434')
  const [models, setModels] = React.useState<ModelItem[]>([])
  const [newModelName, setNewModelName] = React.useState('')
  const [fetchModalOpen, setFetchModalOpen] = React.useState(false)
  const [availableModels, setAvailableModels] = React.useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [fetchError, setFetchError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [existingProvider, setExistingProvider] = React.useState<Provider | null>(null)

  // Store hooks
  const loadAll = useModelStore((state) => state.loadAll)
  const storeProviders = useModelStore((state) => state.providers)
  const storeModels = useModelStore((state) => state.models)

  // Load data when dialog opens
  React.useEffect(() => {
    if (open) {
      loadAll()
    }
  }, [open, loadAll])

  // Load existing provider data when provider type changes
  React.useEffect(() => {
    // Find existing provider of the selected type
    const existing = storeProviders.find((p) => p.provider_type === selectedProvider.id)
    setExistingProvider(existing || null)

    if (existing) {
      // Load existing provider's data
      setApiKey(existing.api_key || '')
      setApiBaseUrl(existing.base_url || 'http://localhost:11434')

      // Load existing models for this provider
      const existingModels = storeModels
        .filter((m) => m.provider_id === existing.id)
        .map((m) => ({
          id: m.id, // Use the database ID
          name: m.model_id, // model_id is the actual model identifier
          isExisting: true, // Mark as existing
        }))
      setModels(existingModels)
    } else {
      // Reset to defaults for new provider
      setApiKey('')
      setApiBaseUrl('http://localhost:11434')
      setModels([])
    }
  }, [selectedProvider, storeProviders, storeModels])

  const handleAddModel = () => {
    if (newModelName.trim()) {
      setModels([
        ...models,
        {
          id: Date.now().toString(),
          name: newModelName.trim(),
        },
      ])
      setNewModelName('')
    }
  }

  const handleUpdateModelName = (id: string, newName: string) => {
    setModels(models.map((model) => (model.id === id ? { ...model, name: newName } : model)))
  }

  const handleDeleteModel = (id: string) => {
    setModels(models.filter((model) => model.id !== id))
  }

  const handleModelSettings = (model: ModelItem) => {
    console.log('Model settings:', model)
    // Add your model settings logic here
  }

  const handleFetchModels = async () => {
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
  }

  const handleOpenFetchModal = () => {
    setFetchModalOpen(true)
    handleFetchModels()
  }

  const handleImportModel = (model: ModelInfo) => {
    // Check if model already exists (by model id)
    if (!models.find((m) => m.name === model.id)) {
      setModels([
        ...models,
        {
          id: Date.now().toString(),
          name: model.id, // Use model.id as the name (this is the actual model identifier)
        },
      ])
    }
  }

  const handleSave = async () => {
    // Filter for new models only
    const newModels = models.filter((m) => !m.isExisting)

    if (newModels.length === 0 && !existingProvider) {
      console.warn('No new models to save')
      onOpenChange(false)
      return
    }

    setIsSaving(true)
    try {
      let providerId: string

      if (existingProvider) {
        // Update existing provider's API key and base URL if changed
        if (
          existingProvider.api_key !== apiKey ||
          existingProvider.base_url !== apiBaseUrl
        ) {
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

      // Create only new models
      for (const model of newModels) {
        const modelReq: CreateModelRequest = {
          name: model.name,
          provider_id: providerId,
          model_id: model.name, // model.name contains the actual model ID
          is_starred: false,
        }
        await invoke('create_model', { req: modelReq })
        console.log('Created model:', model.name)
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
  }

  // Group models by vendor/family
  const groupedModels = React.useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {}
    availableModels.forEach((model) => {
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
  }, [availableModels, selectedProvider])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 gap-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Add LLM Provider</DialogTitle>
        <DialogDescription className="sr-only">
          Configure your LLM provider settings here.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {llmProviders.map((provider) => {
                      const hasExisting = storeProviders.some(
                        (p) => p.provider_type === provider.id
                      )
                      return (
                        <SidebarMenuItem key={provider.id}>
                          <SidebarMenuButton
                            onClick={() => setSelectedProvider(provider)}
                            isActive={provider.id === selectedProvider.id}
                          >
                            <provider.icon />
                            <span>{provider.name}</span>
                            {hasExisting && (
                              <span className="ml-auto text-xs text-muted-foreground">●</span>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Providers</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{selectedProvider.name}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-6 pt-0">
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">
                    {existingProvider ? 'Edit' : 'Add'} {selectedProvider.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {existingProvider
                      ? `Update your ${selectedProvider.name} configuration`
                      : `Configure your ${selectedProvider.name} API settings`}
                  </p>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="api-key">API Key</Label>
                    <Input
                      id="api-key"
                      type="password"
                      placeholder="Enter your API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Your API key will be stored securely
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="api-base-url">API Base URL</Label>
                    <Input
                      id="api-base-url"
                      type="url"
                      placeholder="https://api.example.com/v1"
                      value={apiBaseUrl}
                      onChange={(e) => setApiBaseUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional: Override the default API endpoint
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="model-name">Models</Label>
                    <div className="flex gap-2">
                      <Input
                        id="model-name"
                        placeholder="Enter model name"
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddModel()
                          }
                        }}
                      />
                      <Button type="button" onClick={handleAddModel} size="icon">
                        <Plus className="size-4" />
                      </Button>
                    </div>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">ID</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead className="w-[100px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {models.length > 0 ? (
                            models.map((model, index) => (
                              <TableRow key={model.id}>
                                <TableCell className="font-mono text-sm text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    {index + 1}
                                    {model.isExisting && (
                                      <span
                                        className="text-green-500 text-xs"
                                        title="Saved in database"
                                      >
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Input
                                    value={model.name}
                                    onChange={(e) =>
                                      handleUpdateModelName(model.id, e.target.value)
                                    }
                                    className="h-8"
                                    disabled={model.isExisting}
                                  />
                                </TableCell>
                                <TableCell>
                                  {!model.isExisting && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon-sm">
                                          <MoreHorizontal className="size-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleModelSettings(model)}>
                                          Configure
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={() => handleDeleteModel(model.id)}
                                        >
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell
                                colSpan={3}
                                className="h-24 text-center text-muted-foreground"
                              >
                                No models added yet
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleOpenFetchModal}
                        className="w-full"
                        disabled={
                          !isSupportedFetchProvider(selectedProvider.id) ||
                          (selectedProvider.id !== 'ollama' && !apiKey)
                        }
                      >
                        <Download className="size-4 mr-2" />
                        Fetch Model List
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isSupportedFetchProvider(selectedProvider.id)
                        ? selectedProvider.id === 'ollama'
                          ? 'Fetch models from your local Ollama instance'
                          : apiKey
                            ? `Fetch available models from ${selectedProvider.name}`
                            : `Enter your API key above to fetch models from ${selectedProvider.name}`
                        : `Model fetching is not supported for ${selectedProvider.name}. Add models manually.`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t p-4 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  isSaving ||
                  (models.filter((m) => !m.isExisting).length === 0 &&
                    (!existingProvider ||
                      (existingProvider.api_key === apiKey &&
                        existingProvider.base_url === apiBaseUrl)))
                }
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : existingProvider ? (
                  'Update Configuration'
                ) : (
                  'Save Configuration'
                )}
              </Button>
            </DialogFooter>
          </main>
        </SidebarProvider>
      </DialogContent>

      {/* Fetch Models Dialog */}
      <Dialog open={fetchModalOpen} onOpenChange={setFetchModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[600px] flex flex-col">
          <div className="space-y-2">
            <DialogTitle>Available Models</DialogTitle>
            <DialogDescription>
              Select models from {selectedProvider.name} to add to your configuration
            </DialogDescription>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <p className="text-sm text-destructive mb-2">{fetchError}</p>
                <Button variant="outline" size="sm" onClick={handleFetchModels}>
                  Retry
                </Button>
              </div>
            ) : availableModels.length > 0 ? (
              <div className="space-y-3">
                {Object.entries(groupedModels).map(([groupName, groupModels]) => (
                  <Collapsible key={groupName} defaultOpen={Object.keys(groupedModels).length <= 5}>
                    <div className="rounded-md border">
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className="w-full justify-between p-3 h-auto hover:bg-accent"
                        >
                          <span className="font-semibold">{groupName}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {groupModels.length} {groupModels.length === 1 ? 'model' : 'models'}
                            </span>
                            <ChevronDown className="size-4" />
                          </div>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t">
                          <Table>
                            <TableBody>
                              {groupModels.map((model) => (
                                <TableRow key={model.id}>
                                  <TableCell className="font-medium max-w-[200px]">
                                    <div className="truncate" title={model.name}>
                                      {model.name}
                                    </div>
                                    <div
                                      className="text-xs text-muted-foreground truncate"
                                      title={model.id}
                                    >
                                      {model.id}
                                    </div>
                                  </TableCell>
                                  {model.context_length && (
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                      {(model.context_length / 1000).toFixed(0)}K ctx
                                    </TableCell>
                                  )}
                                  {model.description && (
                                    <TableCell
                                      className="text-xs text-muted-foreground max-w-[200px] truncate"
                                      title={model.description}
                                    >
                                      {model.description}
                                    </TableCell>
                                  )}
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        handleImportModel(model)
                                        setFetchModalOpen(false)
                                      }}
                                    >
                                      Import
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                No models found
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFetchModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
