import { useState, useEffect, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
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
  Wrench,
  Plug,
  Zap,
  RotateCcw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Assistant, CreateAssistantRequest } from '@/types'
import type { Model } from '@/types'
import { BuiltinToolIcon } from '@/components/builtin-tool-icon'
import { isBuiltinTool, isMcpTool, sortBuiltinTools } from '@/types/tool'
import { getSkillsBySource, SKILL_SOURCE_ORDER } from '@/types/skill'
import type { SkillSource } from '@/types/skill'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { usePromptStore } from '@/stores/promptStore'
import { useMcpStore } from '@/stores/mcpStore'
import { useSkillStore } from '@/stores/skillStore'
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
  const { t } = useTranslation(['assistants', 'common'])
  const { models, loadModels, getProviderById } = useModelStore()
  const { assistants, createAssistant, updateAssistant, lastCreatedModelId } = useAssistantStore()
  const { prompts, ensureLoaded: ensurePromptsLoaded } = usePromptStore()
  const { selectedModel, selectedAssistant } = useConversationStore()
  const { servers: allTools, loadServers: loadTools } = useMcpStore()
  const { skills: allSkills, ensureLoaded: ensureSkillsLoaded } = useSkillStore()

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
  const [toolIds, setToolIds] = useState<string[]>([])
  const [skillIds, setSkillIds] = useState<string[]>([])

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
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
  const [activeSection, setActiveSection] = useState('general')
  const [groupComboboxOpen, setGroupComboboxOpen] = useState(false)
  const [groupInputValue, setGroupInputValue] = useState('')

  // Load models, prompts, tools, and skills on mount
  useEffect(() => {
    if (open) {
      if (models.length === 0) {
        loadModels()
      }
      ensurePromptsLoaded()
      loadTools()
      ensureSkillsLoaded()
    }
  }, [open, models.length, loadModels, ensurePromptsLoaded, loadTools, ensureSkillsLoaded])

  // Separate builtin tools and MCP servers for the Tools tab (show all, not just enabled)
  const builtinTools = useMemo(
    () => sortBuiltinTools(allTools.filter((t) => isBuiltinTool(t))),
    [allTools]
  )
  const mcpServers = useMemo(() => allTools.filter((t) => isMcpTool(t)), [allTools])

  // All globally enabled tool IDs
  const globalEnabledToolIds = useMemo(
    () => allTools.filter((t) => t.is_enabled).map((t) => t.id),
    [allTools]
  )

  // All globally enabled skill IDs
  const globalEnabledSkillIds = useMemo(
    () => allSkills.filter((s) => s.is_enabled).map((s) => s.id),
    [allSkills]
  )

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
        name: provider?.name || t('unknownProvider'),
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
      setActiveSection('general')
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
        setToolIds(assistant.tool_ids || [])
        setSkillIds(assistant.skill_ids || [])

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
        setSystemPrompt(t('defaultSystemPrompt'))
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
        setToolIds([])
        setSkillIds([])
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
      setError(t('common:nameIsRequired'))
      return
    }

    if (!selectedModelId) {
      setError(t('common:selectModel'))
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
        tool_ids: toolIds,
        skill_ids: skillIds,
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
    { id: 'general', name: t('common:general'), icon: User },
    { id: 'prompts', name: t('common:prompts'), icon: Sparkles },
    { id: 'model', name: t('common:model'), icon: Bot },
    { id: 'tools', name: t('common:tools'), icon: Wrench },
    { id: 'skills', name: t('common:skills'), icon: Zap },
  ]

  const handleToggleTool = (toolId: string, checked: boolean) => {
    if (checked) {
      setToolIds((prev) => [...prev, toolId])
    } else {
      setToolIds((prev) => prev.filter((id) => id !== toolId))
    }
  }

  const handleToggleSkill = (skillId: string, checked: boolean) => {
    if (checked) {
      setSkillIds((prev) => [...prev, skillId])
    } else {
      setSkillIds((prev) => prev.filter((id) => id !== skillId))
    }
  }

  const renderContent = () => {
    if (activeSection === 'general') {
      return (
        <div className="space-y-4">
          {/* Basic Info */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('common:name')} *</Label>
            <Input
              id="name"
              placeholder={t('assistantNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">{t('role')}</Label>
              <Input
                id="role"
                placeholder={t('rolePlaceholder')}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="group">{t('group')}</Label>
              <Popover open={groupComboboxOpen} onOpenChange={setGroupComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={groupComboboxOpen}
                    className="w-full justify-between"
                  >
                    <span className="truncate">{groupName || t('selectOrCreateGroup')}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder={t('searchOrTypeNewGroup')}
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
                              {t('createNewGroup', { name: groupInputValue.trim() })}
                            </Button>
                          ) : (
                            <div className="text-sm text-muted-foreground text-center">
                              {t('typeToCreateGroup')}
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
            <Label htmlFor="description">{t('assistantDescription')}</Label>
            <Input
              id="description"
              placeholder={t('assistantDescriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Avatar */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="avatar-text">{t('avatarEmoji')}</Label>
              <Input
                id="avatar-text"
                placeholder="🧑‍💼"
                value={avatarText}
                onChange={(e) => setAvatarText(e.target.value)}
                maxLength={10}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="avatar-bg">{t('avatarBackground')}</Label>
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
              {t('addToFavorites')}
            </Label>
          </div>
        </div>
      )
    }

    if (activeSection === 'prompts') {
      return (
        <div className="space-y-6">
          {/* System Prompt Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t('systemPromptRequired')}</Label>
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
                    {t('selectExisting')}
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
                    {t('custom')}
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
                          t('selectPrompt')
                        : t('selectPrompt')}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[300px] flex flex-col p-0">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder={t('searchPrompts')}
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
                        {t('noPromptsFound')}
                      </div>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Textarea
              id="system-prompt"
              placeholder={t('systemPromptPlaceholder')}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={systemPromptMode === 'existing' ? 4 : 6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('definesBehavior')}</p>
          </div>

          {/* User Prompt Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t('userPromptOptional')}</Label>
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
                    {t('none')}
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
                    {t('selectExisting')}
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
                    {t('custom')}
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
                          t('selectPrompt')
                        : t('selectPrompt')}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[300px] flex flex-col p-0">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder={t('searchPrompts')}
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
                        {t('noPromptsFound')}
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
                  placeholder={t('userPromptPlaceholder')}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  rows={userPromptMode === 'existing' ? 3 : 4}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t('prependedToUserMessages')}</p>
              </>
            )}
          </div>
        </div>
      )
    }

    if (activeSection === 'model') {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model">{t('modelRequired')}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="truncate">
                    {selectedModelId
                      ? models.find((m) => m.id === selectedModelId)?.name || t('selectModel')
                      : t('selectModel')}
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
                      placeholder={t('searchModels')}
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
                      {t('noModelsFound')}
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">{t('selectAiModel')}</p>
          </div>
        </div>
      )
    }

    if (activeSection === 'tools') {
      const hasNoTools = builtinTools.length === 0 && mcpServers.length === 0
      const allToolsEnabled =
        globalEnabledToolIds.length > 0 && globalEnabledToolIds.every((id) => toolIds.includes(id))
      const noToolsEnabled =
        globalEnabledToolIds.length > 0 && !globalEnabledToolIds.some((id) => toolIds.includes(id))
      const isToolsDifferentFromGlobal = (() => {
        if (toolIds.length !== globalEnabledToolIds.length) return true
        const sorted = [...toolIds].sort()
        const sortedGlobal = [...globalEnabledToolIds].sort()
        return !sorted.every((id, i) => id === sortedGlobal[i])
      })()

      const renderToolItem = (tool: (typeof allTools)[number]) => {
        const isGloballyDisabled = !tool.is_enabled
        return (
          <div
            key={tool.id}
            className={`flex items-center justify-between py-2 pl-2 ${isGloballyDisabled ? 'opacity-50' : ''}`}
          >
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                {isBuiltinTool(tool) && (
                  <BuiltinToolIcon
                    toolId={tool.id}
                    className="h-4 w-4 text-muted-foreground shrink-0"
                  />
                )}
                <label
                  htmlFor={`tool-${tool.id}`}
                  className={`text-sm font-medium leading-none ${isGloballyDisabled ? 'text-muted-foreground' : 'cursor-pointer'}`}
                >
                  {tool.name}
                </label>
              </div>
              {tool.description && (
                <p className="text-xs text-muted-foreground max-w-[380px]">{tool.description}</p>
              )}
              {isMcpTool(tool) && tool.endpoint && (
                <p className="text-xs text-muted-foreground truncate max-w-[380px]">
                  {tool.endpoint}
                </p>
              )}
              {isGloballyDisabled && (
                <p className="text-xs text-muted-foreground/70 italic">{t('disabledInSettings')}</p>
              )}
            </div>
            {isGloballyDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Switch id={`tool-${tool.id}`} checked={false} disabled />
                  </div>
                </TooltipTrigger>
                <TooltipContent>{t('enableToolInSettings')}</TooltipContent>
              </Tooltip>
            ) : (
              <Switch
                id={`tool-${tool.id}`}
                checked={toolIds.includes(tool.id)}
                onCheckedChange={(checked) => handleToggleTool(tool.id, checked === true)}
              />
            )}
          </div>
        )
      }

      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('toolsDescription')}</p>

          {!hasNoTools && globalEnabledToolIds.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToolIds(globalEnabledToolIds)}
                disabled={allToolsEnabled}
                className="gap-1.5"
              >
                <ToggleRight className="h-3.5 w-3.5" />
                {t('enableAll')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToolIds([])}
                disabled={noToolsEnabled}
                className="gap-1.5"
              >
                <ToggleLeft className="h-3.5 w-3.5" />
                {t('disableAll')}
              </Button>
              {isToolsDifferentFromGlobal && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setToolIds(globalEnabledToolIds)}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('resetToGlobal')}
                </Button>
              )}
            </div>
          )}

          {hasNoTools ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Wrench className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">{t('noToolsAvailable2')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {builtinTools.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    {t('builtinTools')}
                  </h4>
                  {builtinTools.map(renderToolItem)}
                </div>
              )}

              {builtinTools.length > 0 && mcpServers.length > 0 && <Separator />}

              {mcpServers.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Plug className="h-4 w-4" />
                    {t('mcpServers')}
                  </h4>
                  {mcpServers.map(renderToolItem)}
                </div>
              )}
            </div>
          )}

          {toolIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('toolsSelected', { count: toolIds.length })}
            </p>
          )}
        </div>
      )
    }

    if (activeSection === 'skills') {
      const hasNoSkills = allSkills.length === 0

      const skillQuery = skillSearchQuery.toLowerCase().trim()
      const filteredAllSkills = skillQuery
        ? allSkills.filter(
            (s) =>
              s.name.toLowerCase().includes(skillQuery) ||
              (s.description && s.description.toLowerCase().includes(skillQuery))
          )
        : allSkills

      const sourceLabelMap: Record<SkillSource, string> = {
        builtin: t('builtinSkills'),
        user: t('userSkills'),
        claude: t('claudeSkills'),
        agents: t('agentSkills'),
      }
      const allSkillsEnabled =
        globalEnabledSkillIds.length > 0 &&
        globalEnabledSkillIds.every((id) => skillIds.includes(id))
      const noSkillsEnabled =
        globalEnabledSkillIds.length > 0 &&
        !globalEnabledSkillIds.some((id) => skillIds.includes(id))
      const isSkillsDifferentFromGlobal = (() => {
        if (skillIds.length !== globalEnabledSkillIds.length) return true
        const sorted = [...skillIds].sort()
        const sortedGlobal = [...globalEnabledSkillIds].sort()
        return !sorted.every((id, i) => id === sortedGlobal[i])
      })()

      const renderSkillItem = (skill: (typeof allSkills)[number]) => {
        const isGloballyDisabled = !skill.is_enabled
        return (
          <div
            key={skill.id}
            className={`flex items-center justify-between py-2 pl-2 ${isGloballyDisabled ? 'opacity-50' : ''}`}
          >
            <div className="grid gap-1">
              <label
                htmlFor={`skill-${skill.id}`}
                className={`text-sm font-medium leading-none ${isGloballyDisabled ? 'text-muted-foreground' : 'cursor-pointer'}`}
              >
                {skill.icon && <span className="mr-1.5">{skill.icon}</span>}
                {skill.name}
              </label>
              {skill.description && (
                <p
                  className="text-xs text-muted-foreground max-w-[380px] line-clamp-2"
                  title={skill.description}
                >
                  {skill.description}
                </p>
              )}
              {skill.required_tool_ids.length > 0 && (
                <p className="text-xs text-muted-foreground/60">
                  {t('requiresTool', { count: skill.required_tool_ids.length })}
                </p>
              )}
              {isGloballyDisabled && (
                <p className="text-xs text-muted-foreground/70 italic">{t('disabledInSettings')}</p>
              )}
            </div>
            {isGloballyDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Switch id={`skill-${skill.id}`} checked={false} disabled />
                  </div>
                </TooltipTrigger>
                <TooltipContent>{t('enableSkillInSettings')}</TooltipContent>
              </Tooltip>
            ) : (
              <Switch
                id={`skill-${skill.id}`}
                checked={skillIds.includes(skill.id)}
                onCheckedChange={(checked) => handleToggleSkill(skill.id, checked === true)}
              />
            )}
          </div>
        )
      }

      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('skillsDescription')}</p>

          {!hasNoSkills && globalEnabledSkillIds.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSkillIds(globalEnabledSkillIds)}
                disabled={allSkillsEnabled}
                className="gap-1.5"
              >
                <ToggleRight className="h-3.5 w-3.5" />
                {t('enableAll')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSkillIds([])}
                disabled={noSkillsEnabled}
                className="gap-1.5"
              >
                <ToggleLeft className="h-3.5 w-3.5" />
                {t('disableAll')}
              </Button>
              {isSkillsDifferentFromGlobal && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSkillIds(globalEnabledSkillIds)}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('resetToGlobal')}
                </Button>
              )}
            </div>
          )}

          {hasNoSkills ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Zap className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">{t('noSkillsAvailable')}</p>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('common:search')}
                  value={skillSearchQuery}
                  onChange={(e) => setSkillSearchQuery(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>

              {filteredAllSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('common:noResults')}
                </p>
              ) : (
                SKILL_SOURCE_ORDER.map((source, idx) => {
                  const sourceSkills = getSkillsBySource(filteredAllSkills, source)
                  if (sourceSkills.length === 0) return null
                  return (
                    <Fragment key={source}>
                      {idx > 0 &&
                        SKILL_SOURCE_ORDER.slice(0, idx).some(
                          (prev) => getSkillsBySource(filteredAllSkills, prev).length > 0
                        ) && <Separator />}
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <Zap className="h-4 w-4" />
                          {sourceLabelMap[source] ?? source}
                        </h4>
                        {sourceSkills.map(renderSkillItem)}
                      </div>
                    </Fragment>
                  )
                })
              )}
            </>
          )}

          {skillIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('skillsSelected', { count: skillIds.length })}
            </p>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 gap-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">
          {mode === 'edit' ? t('editAssistant') : t('newAssistant')}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {mode === 'edit' ? t('editDescription') : t('createDescription')}
        </DialogDescription>

        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === activeSection}
                          onClick={() => setActiveSection(item.id)}
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
                        {mode === 'edit' ? t('editAssistant') : t('createAssistant')}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>
                        {activeSection === 'general' && t('common:general')}
                        {activeSection === 'prompts' && t('common:prompts')}
                        {activeSection === 'model' && t('common:model')}
                        {activeSection === 'tools' && t('common:tools')}
                        {activeSection === 'skills' && t('common:skills')}
                      </BreadcrumbPage>
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
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t('saving')}
                  </>
                ) : mode === 'edit' ? (
                  t('common:saveChanges')
                ) : (
                  t('createAssistant')
                )}
              </Button>
            </footer>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
