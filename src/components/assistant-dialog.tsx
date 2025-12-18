import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Loader2,
  ChevronDown,
  Search,
  User,
  Sparkles,
  Bot,
  Check,
  ChevronsUpDown,
} from 'lucide-react'
import type { Assistant, CreateAssistantRequest } from '@/types'
import type { Model } from '@/types'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'
import { useConversationStore } from '@/stores/conversation'
import { getRandomPresetColor, getRandomNameAndEmoji } from '@/lib/assistant-utils'
import { logger } from '@/lib/logger'

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
  const { assistants, createAssistant, updateAssistant, lastCreatedModelId } = useAssistantStore()
  const { prompts, ensureLoaded: ensurePromptsLoaded } = usePromptStore()
  const { selectedModel, selectedAssistant } = useConversationStore()

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

  // System Prompt mode state
  const [systemPromptMode, setSystemPromptMode] = useState<'existing' | 'custom'>('existing')
  const [selectedSystemPromptId, setSelectedSystemPromptId] = useState('')
  const [systemPromptSearchQuery, setSystemPromptSearchQuery] = useState('')

  // User Prompt mode state
  const [userPromptMode, setUserPromptMode] = useState<'none' | 'existing' | 'custom'>('none')
  const [selectedUserPromptId, setSelectedUserPromptId] = useState('')
  const [userPromptSearchQuery, setUserPromptSearchQuery] = useState('')

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [activeSection, setActiveSection] = useState('Basic')
  const [groupComboboxOpen, setGroupComboboxOpen] = useState(false)
  const [groupInputValue, setGroupInputValue] = useState('')

  // Load models and prompts on mount
  useEffect(() => {
    if (open) {
      if (models.length === 0) {
        loadModels()
      }
      ensurePromptsLoaded()
    }
  }, [open, models.length, loadModels, ensurePromptsLoaded])

  // Get unique group names from existing assistants
  const existingGroups = useMemo(() => {
    const groups = new Set<string>()
    assistants.forEach((a) => {
      if (a.group_name) {
        groups.add(a.group_name)
      }
    })
    return Array.from(groups).sort()
  }, [assistants])

  // Filter groups by input value
  const filteredGroups = useMemo(() => {
    if (!groupInputValue.trim()) return existingGroups
    const query = groupInputValue.toLowerCase()
    return existingGroups.filter((group) => group.toLowerCase().includes(query))
  }, [existingGroups, groupInputValue])

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
            model.name.toLowerCase().includes(query) || model.model_id.toLowerCase().includes(query)
        ),
      }))
      .filter((provider) => provider.models.length > 0)
  }, [modelsByProvider, modelSearchQuery])

  // Filter prompts by search query for system prompt (only system prompts)
  const filteredSystemPrompts = useMemo(() => {
    // First filter to only system prompts (is_system === true)
    const systemPrompts = prompts.filter((p) => p.is_system)

    if (!systemPromptSearchQuery.trim()) return systemPrompts

    const query = systemPromptSearchQuery.toLowerCase()
    return systemPrompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.content.toLowerCase().includes(query) ||
        (prompt.description && prompt.description.toLowerCase().includes(query))
    )
  }, [prompts, systemPromptSearchQuery])

  // Filter prompts by search query for user prompt (only user prompts)
  const filteredUserPrompts = useMemo(() => {
    // First filter to only user prompts (is_system === false)
    const userPrompts = prompts.filter((p) => !p.is_system)

    if (!userPromptSearchQuery.trim()) return userPrompts

    const query = userPromptSearchQuery.toLowerCase()
    return userPrompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.content.toLowerCase().includes(query) ||
        (prompt.description && prompt.description.toLowerCase().includes(query))
    )
  }, [prompts, userPromptSearchQuery])

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
        setGroupInputValue('')
        setIsStarred(assistant.is_starred)

        // Check if system prompt matches an existing system prompt (is_system === true)
        const matchingSystemPrompt = prompts.find(
          (p) => p.is_system && p.content === assistant.system_prompt
        )
        if (matchingSystemPrompt) {
          setSystemPromptMode('existing')
          setSelectedSystemPromptId(matchingSystemPrompt.id)
        } else {
          setSystemPromptMode('custom')
          setSelectedSystemPromptId('')
        }

        // Check if user prompt matches an existing user prompt (is_system === false)
        if (assistant.user_prompt) {
          const matchingUserPrompt = prompts.find(
            (p) => !p.is_system && p.content === assistant.user_prompt
          )
          if (matchingUserPrompt) {
            setUserPromptMode('existing')
            setSelectedUserPromptId(matchingUserPrompt.id)
          } else {
            setUserPromptMode('custom')
            setSelectedUserPromptId('')
          }
        } else {
          setUserPromptMode('none')
          setSelectedUserPromptId('')
        }
      } else {
        // Reset form for create mode
        const { name: randomName, emoji: randomEmoji } = getRandomNameAndEmoji()
        setName(randomName)
        setRole('')
        setDescription('')
        setSystemPrompt('You are a helpful AI assistant.')
        setUserPrompt('')

        // Select default model based on:
        // 1. Last created assistant's model
        // 2. Current conversation's selected model or assistant's model
        // 3. First available model
        let defaultModelId = ''
        if (models.length > 0) {
          // 1. Check if lastCreatedModelId exists and is valid
          if (lastCreatedModelId && models.some((m) => m.id === lastCreatedModelId)) {
            defaultModelId = lastCreatedModelId
          }
          // 2. If not, check conversation's selected model
          else if (selectedModel && models.some((m) => m.id === selectedModel.id)) {
            defaultModelId = selectedModel.id
          }
          // 3. If not, check conversation's selected assistant's model
          else if (selectedAssistant && models.some((m) => m.id === selectedAssistant.model_id)) {
            defaultModelId = selectedAssistant.model_id
          }
          // 4. Fall back to first model
          else {
            defaultModelId = models[0].id
          }
        }
        setSelectedModelId(defaultModelId)

        setAvatarText(randomEmoji)
        setAvatarBg(getRandomPresetColor())
        setGroupName('')
        setGroupInputValue('')
        setIsStarred(false)
        setSystemPromptMode('existing')
        setSelectedSystemPromptId('')
        setSystemPromptSearchQuery('')
        setUserPromptMode('none')
        setSelectedUserPromptId('')
        setUserPromptSearchQuery('')
      }
      setError(null)
    }
  }, [open, mode, assistant, models, prompts, lastCreatedModelId, selectedModel, selectedAssistant])

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
      logger.error('Failed to save assistant:', err)
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
              <Popover open={groupComboboxOpen} onOpenChange={setGroupComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={groupComboboxOpen}
                    className="w-full justify-between"
                  >
                    <span className="truncate">{groupName || 'Select or create group...'}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or type new group..."
                      value={groupInputValue}
                      onValueChange={setGroupInputValue}
                    />
                    <CommandList>
                      <CommandEmpty>
                        <div className="py-2 px-2">
                          {groupInputValue.trim() ? (
                            <Button
                              variant="ghost"
                              className="w-full justify-start"
                              onClick={() => {
                                setGroupName(groupInputValue.trim())
                                setGroupComboboxOpen(false)
                                setGroupInputValue('')
                              }}
                            >
                              Create "{groupInputValue.trim()}"
                            </Button>
                          ) : (
                            <div className="text-sm text-muted-foreground text-center">
                              Type to create a new group
                            </div>
                          )}
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredGroups.map((group) => (
                          <CommandItem
                            key={group}
                            value={group}
                            onSelect={() => {
                              setGroupName(group)
                              setGroupComboboxOpen(false)
                              setGroupInputValue('')
                            }}
                          >
                            {group}
                            <Check
                              className={
                                groupName === group ? 'ml-auto opacity-100' : 'ml-auto opacity-0'
                              }
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
        <div className="space-y-6">
          {/* System Prompt Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">System Prompt *</Label>
              <div className="flex gap-3">
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="system-prompt-existing"
                    name="system-prompt-mode"
                    checked={systemPromptMode === 'existing'}
                    onChange={() => setSystemPromptMode('existing')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label
                    htmlFor="system-prompt-existing"
                    className="cursor-pointer font-normal text-xs"
                  >
                    Select Existing
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="system-prompt-custom"
                    name="system-prompt-mode"
                    checked={systemPromptMode === 'custom'}
                    onChange={() => setSystemPromptMode('custom')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label
                    htmlFor="system-prompt-custom"
                    className="cursor-pointer font-normal text-xs"
                  >
                    Custom
                  </Label>
                </div>
              </div>
            </div>

            {/* System Prompt Selection */}
            {systemPromptMode === 'existing' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">
                      {selectedSystemPromptId
                        ? prompts.find((p) => p.id === selectedSystemPromptId)?.name ||
                          'Select a prompt'
                        : 'Select a prompt'}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[300px] flex flex-col p-0">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts..."
                        value={systemPromptSearchQuery}
                        onChange={(e) => setSystemPromptSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-[240px]">
                    {filteredSystemPrompts.length > 0 ? (
                      filteredSystemPrompts.map((prompt) => (
                        <DropdownMenuItem
                          key={prompt.id}
                          onClick={() => {
                            setSelectedSystemPromptId(prompt.id)
                            setSystemPrompt(prompt.content)
                            setSystemPromptSearchQuery('')
                          }}
                          className="flex flex-col items-start"
                        >
                          <span className="font-medium">{prompt.name}</span>
                          {prompt.description && (
                            <span className="text-xs text-muted-foreground">
                              {prompt.description}
                            </span>
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
            )}

            <Textarea
              id="system-prompt"
              placeholder="You are a helpful AI assistant..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={systemPromptMode === 'existing' ? 4 : 6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Defines the assistant's behavior and personality (sent as system message)
            </p>
          </div>

          {/* User Prompt Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">User Prompt (Optional)</Label>
              <div className="flex gap-3">
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="user-prompt-none"
                    name="user-prompt-mode"
                    checked={userPromptMode === 'none'}
                    onChange={() => {
                      setUserPromptMode('none')
                      setUserPrompt('')
                      setSelectedUserPromptId('')
                    }}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="user-prompt-none" className="cursor-pointer font-normal text-xs">
                    None
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="user-prompt-existing"
                    name="user-prompt-mode"
                    checked={userPromptMode === 'existing'}
                    onChange={() => setUserPromptMode('existing')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label
                    htmlFor="user-prompt-existing"
                    className="cursor-pointer font-normal text-xs"
                  >
                    Select Existing
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="user-prompt-custom"
                    name="user-prompt-mode"
                    checked={userPromptMode === 'custom'}
                    onChange={() => setUserPromptMode('custom')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label
                    htmlFor="user-prompt-custom"
                    className="cursor-pointer font-normal text-xs"
                  >
                    Custom
                  </Label>
                </div>
              </div>
            </div>

            {/* User Prompt Selection */}
            {userPromptMode === 'existing' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">
                      {selectedUserPromptId
                        ? prompts.find((p) => p.id === selectedUserPromptId)?.name ||
                          'Select a prompt'
                        : 'Select a prompt'}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[300px] flex flex-col p-0">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts..."
                        value={userPromptSearchQuery}
                        onChange={(e) => setUserPromptSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-[240px]">
                    {filteredUserPrompts.length > 0 ? (
                      filteredUserPrompts.map((prompt) => (
                        <DropdownMenuItem
                          key={prompt.id}
                          onClick={() => {
                            setSelectedUserPromptId(prompt.id)
                            setUserPrompt(prompt.content)
                            setUserPromptSearchQuery('')
                          }}
                          className="flex flex-col items-start"
                        >
                          <span className="font-medium">{prompt.name}</span>
                          {prompt.description && (
                            <span className="text-xs text-muted-foreground">
                              {prompt.description}
                            </span>
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
            )}

            {userPromptMode !== 'none' && (
              <>
                <Textarea
                  id="user-prompt"
                  placeholder="Additional context or instructions..."
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  rows={userPromptMode === 'existing' ? 3 : 4}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  This will be prepended to user messages
                </p>
              </>
            )}
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
      <DialogContent className="overflow-hidden p-0 gap-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[900px]">
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

          <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
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
