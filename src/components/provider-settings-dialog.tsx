'use client'

import * as React from 'react'
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
}

interface AvailableModel {
  name: string
  size: number
  modified_at: string
  digest: string
  details?: {
    parameter_size?: string
    quantization_level?: string
    family?: string
  }
}

export function ProviderSettingsDialog({ open, onOpenChange }: ProviderSettingsDialogProps) {
  const [selectedProvider, setSelectedProvider] = React.useState(llmProviders[0])
  const [apiKey, setApiKey] = React.useState('')
  const [apiBaseUrl, setApiBaseUrl] = React.useState('')
  const [models, setModels] = React.useState<ModelItem[]>([])
  const [newModelName, setNewModelName] = React.useState('')
  const [fetchModalOpen, setFetchModalOpen] = React.useState(false)
  const [availableModels, setAvailableModels] = React.useState<AvailableModel[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [fetchError, setFetchError] = React.useState<string | null>(null)

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
    try {
      // Fetch models from Ollama API
      const response = await fetch('http://localhost:11434/api/tags')
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`)
      }
      const data = await response.json()

      // Process models to extract details
      const processedModels = (data.models || []).map((model: any) => ({
        name: model.name,
        size: model.size,
        modified_at: model.modified_at,
        digest: model.digest,
        details: {
          parameter_size: model.details?.parameter_size,
          quantization_level: model.details?.quantization_level,
          family: model.details?.family,
        },
      }))

      setAvailableModels(processedModels)
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

  const handleImportModel = (modelName: string) => {
    // Check if model already exists
    if (!models.find((m) => m.name === modelName)) {
      setModels([
        ...models,
        {
          id: Date.now().toString(),
          name: modelName,
        },
      ])
    }
  }

  const handleSave = () => {
    console.log('Saving provider configuration:', {
      provider: selectedProvider.id,
      apiKey,
      apiBaseUrl,
      models: models.map((m) => m.name),
    })
    // Add your save logic here
    onOpenChange(false)
  }

  // Group models by family
  const groupedModels = React.useMemo(() => {
    const groups: Record<string, AvailableModel[]> = {}
    availableModels.forEach((model) => {
      const family = model.details?.family || 'Other'
      if (!groups[family]) {
        groups[family] = []
      }
      groups[family].push(model)
    })
    return groups
  }, [availableModels])

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
                    {llmProviders.map((provider) => (
                      <SidebarMenuItem key={provider.id}>
                        <SidebarMenuButton
                          onClick={() => setSelectedProvider(provider)}
                          isActive={provider.id === selectedProvider.id}
                        >
                          <provider.icon />
                          <span>{provider.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
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
                  <h3 className="text-lg font-semibold">Provider Configuration</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure your {selectedProvider.name} API settings
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
                                  {index + 1}
                                </TableCell>
                                <TableCell>
                                  <Input
                                    value={model.name}
                                    onChange={(e) =>
                                      handleUpdateModelName(model.id, e.target.value)
                                    }
                                    className="h-8"
                                  />
                                </TableCell>
                                <TableCell>
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
                      >
                        <Download className="size-4 mr-2" />
                        Fetch Model List
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Add models one at a time by entering the model name and clicking the plus
                      button
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t p-4 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save Configuration</Button>
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
                {Object.entries(groupedModels).map(([family, familyModels]) => (
                  <Collapsible key={family} defaultOpen={true}>
                    <div className="rounded-md border">
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className="w-full justify-between p-3 h-auto hover:bg-accent"
                        >
                          <span className="font-semibold">{family}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {familyModels.length} {familyModels.length === 1 ? 'model' : 'models'}
                            </span>
                            <ChevronDown className="size-4" />
                          </div>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t">
                          <Table>
                            <TableBody>
                              {familyModels.map((model) => (
                                <TableRow key={model.digest}>
                                  <TableCell className="font-medium">{model.name}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {(model.size / 1024 / 1024 / 1024).toFixed(2)} GB
                                  </TableCell>
                                  {model.details?.parameter_size && (
                                    <TableCell className="text-xs text-muted-foreground">
                                      {model.details.parameter_size}
                                    </TableCell>
                                  )}
                                  {model.details?.quantization_level && (
                                    <TableCell className="text-xs text-muted-foreground">
                                      {model.details.quantization_level}
                                    </TableCell>
                                  )}
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        handleImportModel(model.name)
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
