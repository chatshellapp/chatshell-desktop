import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Loader2, ChevronDown, Search, User, Sparkles, Bot } from 'lucide-react'
import type { Assistant, CreateAssistantRequest, Prompt } from '@/types'
import type { Model } from '@/types'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'

interface AssistantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assistant?: Assistant | null
  mode?: 'create' | 'edit'
}

export function AssistantDialog({
  open,
  onOpenChange,
  assistant,
  mode = 'create',
}: AssistantDialogProps) {
  const { models, loadModels, getProviderById } = useModelStore()
  const { createAssistant, updateAssistant } = useAssistantStore()
  const { prompts, ensureLoaded: ensurePromptsLoaded } = usePromptStore()

  // Form state
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [avatarText, setAvatarText] = useState('')
  const [avatarBg, setAvatarBg] = useState('#3b82f6')
  const [groupName, setGroupName] = useState('')
  const [isStarred, setIsStarred] = useState(false)

  // Prompt mode state
  const [promptMode, setPromptMode] = useState<'existing' | 'custom'>('custom')
  const [selectedPromptId, setSelectedPromptId] = useState('')
  const [promptSearchQuery, setPromptSearchQuery] = useState('')

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [activeSection, setActiveSection] = useState('Basic')

  // Load models and prompts on mount
  useEffect(() => {
    if (open) {
      if (models.length === 0) {
        loadModels()
      }
      ensurePromptsLoaded()
    }
  }, [open, models.length, loadModels, ensurePromptsLoaded])

  // Group models by provider
  const modelsByProvider = useMemo(() => {
    const providerMap = new Map<string, Model[]>()

    models.forEach((model) => {
      const provider = getProviderById(model.provider_id)
      const providerKey = provider?.id || 'unknown'

      if (!providerMap.has(providerKey)) {
        providerMap.set(providerKey, [])
      }
      providerMap.get(providerKey)!.push(model)
    })

    return Array.from(providerMap.entries()).map(([providerId, models]) => {
      const provider = getProviderById(providerId)
      return {
        id: providerId,
        name: provider?.name || 'Unknown Provider',
        models: models.sort((a, b) => a.name.localeCompare(b.name)),
      }
    })
  }, [models, getProviderById])

  // Filter models by search query
  const filteredProviders = useMemo(() => {
    if (!modelSearchQuery.trim()) return modelsByProvider

    const query = modelSearchQuery.toLowerCase()
    return modelsByProvider
      .map((provider) => ({
        ...provider,
        models: provider.models.filter(
          (model) =>
            model.name.toLowerCase().includes(query) ||
            model.model_id.toLowerCase().includes(query)
        ),
      }))
      .filter((provider) => provider.models.length > 0)
  }, [modelsByProvider, modelSearchQuery])

  // Filter prompts by search query
  const filteredPrompts = useMemo(() => {
    if (!promptSearchQuery.trim()) return prompts

    const query = promptSearchQuery.toLowerCase()
    return prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.content.toLowerCase().includes(query) ||
        (prompt.description && prompt.description.toLowerCase().includes(query))
    )
  }, [prompts, promptSearchQuery])

  // Initialize form when assistant changes or dialog opens
  useEffect(() => {
    if (open) {
      setActiveSection('Basic')
      if (mode === 'edit' && assistant) {
        setName(assistant.name)
        setRole(assistant.role || '')
        setDescription(assistant.description || '')
        setSystemPrompt(assistant.system_prompt)
        setUserPrompt(assistant.user_prompt || '')
        setSelectedModelId(assistant.model_id)
        setAvatarText(assistant.avatar_text || '')
        setAvatarBg(assistant.avatar_bg || '#3b82f6')
        setGroupName(assistant.group_name || '')
        setIsStarred(assistant.is_starred)
        
        // Check if system prompt matches an existing prompt
        const matchingPrompt = prompts.find((p) => p.content === assistant.system_prompt)
        if (matchingPrompt) {
          setPromptMode('existing')
          setSelectedPromptId(matchingPrompt.id)
        } else {
          setPromptMode('custom')
          setSelectedPromptId('')
        }
      } else {
        // Reset form for create mode
        setName('')
        setRole('')
        setDescription('')
        setSystemPrompt('You are a helpful AI assistant.')
        setUserPrompt('')
        setSelectedModelId(models.length > 0 ? models[0].id : '')
        setAvatarText('🧑‍💼')
        setAvatarBg('#3b82f6')
        setGroupName('')
        setIsStarred(false)
        setPromptMode('custom')
        setSelectedPromptId('')
      }
      setError(null)
    }
  }, [open, mode, assistant, models, prompts])

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    if (!selectedModelId) {
      setError('Please select a model')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const req: CreateAssistantRequest = {
        name: name.trim(),
        role: role.trim() || undefined,
        description: description.trim() || undefined,
        system_prompt: systemPrompt,
        user_prompt: userPrompt.trim() || undefined,
        model_id: selectedModelId,
        avatar_type: 'text',
        avatar_bg: avatarBg,
        avatar_text: avatarText || '🧑‍💼',
        group_name: groupName.trim() || undefined,
        is_starred: isStarred,
      }

      if (mode === 'edit' && assistant) {
        await updateAssistant(assistant.id, req)
      } else {
        await createAssistant(req)
      }

      onOpenChange(false)
    } catch (err) {
      console.error('Failed to save assistant:', err)
      setError(String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const navItems = [
    { name: 'Basic', icon: User },
    { name: 'Prompts', icon: Sparkles },
    { name: 'Models', icon: Bot },
  ]

  const renderContent = () => {
    if (activeSection === 'Basic') {
      return (
        <div className="space-y-4">
          {/* Basic Info */}
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Sam"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input
                id="role"
                placeholder="e.g., Coding Expert"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="group">Group</Label>
              <Input
                id="group"
                placeholder="e.g., Development"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Brief description of what this assistant does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Avatar */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="avatar-text">Avatar Emoji</Label>
              <Input
                id="avatar-text"
                placeholder="🧑‍💼"
                value={avatarText}
                onChange={(e) => setAvatarText(e.target.value)}
                maxLength={10}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="avatar-bg">Avatar Background</Label>
              <div className="flex gap-2">
                <Input
                  id="avatar-bg"
                  type="color"
                  value={avatarBg}
                  onChange={(e) => setAvatarBg(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={avatarBg}
                  onChange={(e) => setAvatarBg(e.target.value)}
                  placeholder="#3b82f6"
                />
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-starred"
              checked={isStarred}
              onChange={(e) => setIsStarred(e.target.checked)}
              className="size-4"
            />
            <Label htmlFor="is-starred" className="cursor-pointer">
              Add to favorites
            </Label>
          </div>
        </div>
      )
    }

    if (activeSection === 'Prompts') {
      return (
        <div className="space-y-4">
          {/* Prompt Mode Selection */}
          <div className="space-y-2">
            <Label>Prompt Type</Label>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="prompt-existing"
                  name="prompt-mode"
                  checked={promptMode === 'existing'}
                  onChange={() => setPromptMode('existing')}
                  className="size-4 cursor-pointer"
                />
                <Label htmlFor="prompt-existing" className="cursor-pointer font-normal">
                  Select Existing
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="prompt-custom"
                  name="prompt-mode"
                  checked={promptMode === 'custom'}
                  onChange={() => setPromptMode('custom')}
                  className="size-4 cursor-pointer"
                />
                <Label htmlFor="prompt-custom" className="cursor-pointer font-normal">
                  Custom
                </Label>
              </div>
            </div>
          </div>

          {/* Existing Prompt Selection */}
          {promptMode === 'existing' && (
            <div className="space-y-2">
              <Label htmlFor="existing-prompt">Select Prompt</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">
                      {selectedPromptId
                        ? prompts.find((p) => p.id === selectedPromptId)?.name || 'Select a prompt'
                        : 'Select a prompt'}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[400px] flex flex-col p-0">
                  {/* Search Input */}
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts..."
                        value={promptSearchQuery}
                        onChange={(e) => setPromptSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {/* Prompts list */}
                  <div className="overflow-y-auto max-h-[320px]">
                    {filteredPrompts.length > 0 ? (
                      filteredPrompts.map((prompt) => (
                        <DropdownMenuItem
                          key={prompt.id}
                          onClick={() => {
                            setSelectedPromptId(prompt.id)
                            setSystemPrompt(prompt.content)
                            setPromptSearchQuery('')
                          }}
                          className="flex flex-col items-start"
                        >
                          <span className="font-medium">{prompt.name}</span>
                          {prompt.description && (
                            <span className="text-xs text-muted-foreground">{prompt.description}</span>
                          )}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No prompts found
                      </div>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-xs text-muted-foreground">
                Choose from existing prompts to use as the system prompt
              </p>
            </div>
          )}

          {/* System Prompt Display/Edit */}
          <div className="space-y-2">
            <Label htmlFor="system-prompt">System Prompt *</Label>
            <Textarea
              id="system-prompt"
              placeholder="You are a helpful AI assistant..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={promptMode === 'existing' ? 8 : 10}
              className="font-mono text-sm"
              disabled={promptMode === 'existing'}
            />
            <p className="text-xs text-muted-foreground">
              {promptMode === 'existing'
                ? 'Preview of the selected prompt (read-only)'
                : 'This defines the assistant\'s behavior and personality (sent as system message)'}
            </p>
          </div>

          {/* User Prompt */}
          <div className="space-y-2">
            <Label htmlFor="user-prompt">User Prompt (Optional)</Label>
            <Textarea
              id="user-prompt"
              placeholder="Additional context or instructions..."
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={4}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              This will be prepended to user messages (optional)
            </p>
          </div>
        </div>
      )
    }

    if (activeSection === 'Models') {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model">Model *</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="truncate">
                    {selectedModelId
                      ? models.find((m) => m.id === selectedModelId)?.name || 'Select a model'
                      : 'Select a model'}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full max-h-[400px] flex flex-col p-0">
                {/* Search Input */}
                <div className="p-2 border-b">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search models..."
                      value={modelSearchQuery}
                      onChange={(e) => setModelSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {/* Models grouped by provider */}
                <div className="overflow-y-auto max-h-[320px]">
                  {filteredProviders.length > 0 ? (
                    filteredProviders.map((provider) => (
                      <Collapsible key={provider.id} defaultOpen={true}>
                        <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50">
                          <span>{provider.name}</span>
                          <ChevronDown className="size-3.5 transition-transform duration-200 data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          {provider.models.map((model) => (
                            <DropdownMenuItem
                              key={model.id}
                              onClick={() => {
                                setSelectedModelId(model.id)
                                setModelSearchQuery('')
                              }}
                              className="pl-6"
                            >
                              <span className="truncate">{model.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    ))
                  ) : (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      No models found
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              Select the AI model that will power this assistant
            </p>
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[700px] md:max-w-[800px] lg:max-w-[1000px]">
        <DialogTitle className="sr-only">
          {mode === 'edit' ? 'Edit Assistant' : 'Create New Assistant'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {mode === 'edit'
            ? 'Modify the assistant configuration below.'
            : 'Configure your new AI assistant with custom prompts and settings.'}
        </DialogDescription>

        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          isActive={item.name === activeSection}
                          onClick={() => setActiveSection(item.name)}
                        >
                          <item.icon />
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <main className="flex h-[700px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">
                        {mode === 'edit' ? 'Edit Assistant' : 'Create Assistant'}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeSection}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              {error && (
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                  {error}
                </div>
              )}
              {renderContent()}
            </div>

            <footer className="flex shrink-0 items-center justify-end gap-2 border-t p-4">
              <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : mode === 'edit' ? (
                  'Save Changes'
                ) : (
                  'Create Assistant'
                )}
              </Button>
            </footer>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

