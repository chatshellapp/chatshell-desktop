import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group'
import {
  ImageLightbox,
  FilePreviewDialog,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { X, Sparkles, FolderOpen } from 'lucide-react'

import { useAttachments } from './useAttachments'
import { useKeyboardHandlers } from './useKeyboardHandlers'
import { useSubmitHandler } from './useSubmitHandler'
import { AttachmentPreviewRow } from './AttachmentPreviewRow'
import { WebPageDialog } from './WebPageDialog'
import { DropZoneOverlay } from './DropZoneOverlay'
import { InputToolbar } from './InputToolbar'
import { ModelParametersDialog } from './ModelParametersDialog'
import { ContextCountDialog } from './ContextCountDialog'
import { SystemPromptDialog } from './SystemPromptDialog'
import { UserPromptQuickSelectDialog } from './UserPromptQuickSelectDialog'
import { McpServersDialog } from './McpServersDialog'
import { SkillsDialog } from './SkillsDialog'
import { useConversationStore } from '@/stores/conversation'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/promptStore'
import { useMessageStore } from '@/stores/message'
import { useMcpStore } from '@/stores/mcpStore'
import { useSkillStore } from '@/stores/skillStore'
import { useModelStore } from '@/stores/modelStore'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
import { getContextCountOptions } from '@/types'
import type { ModelParameterPreset, PromptMode } from '@/types'
import { logger } from '@/lib/logger'

// interface ChatInputProps {}

export function ChatInput(/* _props: ChatInputProps */) {
  const { t } = useTranslation('chat')
  // State
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState<'models' | 'assistants'>('models')
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isWebPageDialogOpen, setIsWebPageDialogOpen] = useState(false)
  const [isModelParametersDialogOpen, setIsModelParametersDialogOpen] = useState(false)
  const [isContextCountDialogOpen, setIsContextCountDialogOpen] = useState(false)
  const [isSystemPromptDialogOpen, setIsSystemPromptDialogOpen] = useState(false)
  const [isUserPromptDialogOpen, setIsUserPromptDialogOpen] = useState(false)
  const [isMcpServersDialogOpen, setIsMcpServersDialogOpen] = useState(false)
  const [isSkillsDialogOpen, setIsSkillsDialogOpen] = useState(false)
  // Preview state for attachments
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null)
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number | null>(null)
  // Parameter presets for displaying names
  const [parameterPresets, setParameterPresets] = useState<ModelParameterPreset[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cursorPositionRef = useRef<number | null>(null)

  // Model capability awareness (computed early so useAttachments can use visionDisabled)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const selectedModelEarly = useConversationStore((state) => state.selectedModel)
  const selectedProviderEarly = useMemo(
    () => (selectedModelEarly ? getProviderById(selectedModelEarly.provider_id) : null),
    [selectedModelEarly, getProviderById]
  )
  const capabilities = useModelCapabilities(selectedModelEarly, selectedProviderEarly ?? null)
  const toolsDisabled = capabilities.supports_tool_use === false
  const visionDisabled = capabilities.supports_vision === false

  // Attachment handling hook
  const {
    attachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    handleFileSelect,
    handleImageSelect,
    handlePaste,
    isDraggingOver,
    dragHandlers,
  } = useAttachments({ visionDisabled })

  // Submit handling hook
  const {
    handleSend,
    handleStop,
    isStreaming,
    isWaitingForAI,
    isSending,
    selectedModel,
    selectedAssistant,
    currentConversation,
  } = useSubmitHandler({
    input,
    setInput,
    attachments,
    clearAttachments,
    webSearchEnabled: false,
  })

  // Keyboard handling hook
  const { handleKeyDown } = useKeyboardHandlers({
    input,
    setInput,
    onSubmit: handleSend,
  })

  // Conversation settings - subscribe to the entire settings object for this conversation
  const allSettings = useConversationSettingsStore((state) => state.settings)
  const getSettings = useConversationSettingsStore((state) => state.getSettings)
  const setUseProviderDefaults = useConversationSettingsStore(
    (state) => state.setUseProviderDefaults
  )
  const setParameterOverrides = useConversationSettingsStore((state) => state.setParameterOverrides)
  const setUseCustomParameters = useConversationSettingsStore(
    (state) => state.setUseCustomParameters
  )
  const setSelectedPresetId = useConversationSettingsStore((state) => state.setSelectedPresetId)
  const setContextMessageCount = useConversationSettingsStore(
    (state) => state.setContextMessageCount
  )
  const setSystemPrompt = useConversationSettingsStore((state) => state.setSystemPrompt)
  const setEnabledMcpServerIds = useConversationSettingsStore(
    (state) => state.setEnabledMcpServerIds
  )
  const setEnabledSkillIds = useConversationSettingsStore((state) => state.setEnabledSkillIds)
  const setWorkingDirectory = useConversationSettingsStore((state) => state.setWorkingDirectory)

  // Prompt store for getting prompt names
  const { prompts, ensureLoaded: ensurePromptsLoaded } = usePromptStore()

  // MCP store for getting server names
  const mcpServers = useMcpStore((state) => state.servers)
  const ensureMcpServersLoaded = useMcpStore((state) => state.ensureLoaded)

  // Skill store for getting skill names
  const allSkills = useSkillStore((state) => state.skills)
  const ensureSkillsLoaded = useSkillStore((state) => state.ensureLoaded)

  // Get message count from message store to determine if system prompt can be changed
  const conversationState = useMessageStore((state) =>
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )
  const hasMessages = (conversationState?.messages?.length ?? 0) > 0

  // Get current conversation settings - this will update when allSettings changes
  const conversationSettings = useMemo(() => {
    if (!currentConversation) return null
    return allSettings[currentConversation.id] || null
  }, [currentConversation, allSettings])

  // Load parameter presets on mount
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const presets = await invoke<ModelParameterPreset[]>('list_model_parameter_presets')
        setParameterPresets(presets)
      } catch (error) {
        logger.error('Failed to load parameter presets:', error)
      }
    }
    loadPresets()
  }, [])

  // Compute display labels
  const modelParametersLabel = useMemo(() => {
    if (!conversationSettings) return t('common:default')
    if (conversationSettings.useProviderDefaults) return t('common:default')
    if (conversationSettings.useCustomParameters) return t('custom')
    if (conversationSettings.selectedPresetId) {
      const preset = parameterPresets.find((p) => p.id === conversationSettings.selectedPresetId)
      return preset?.name || t('preset')
    }
    // No explicit selection - show Default (will use assistant preset if available)
    return t('common:default')
  }, [conversationSettings, parameterPresets, t])

  const contextCountLabel = useMemo(() => {
    if (!conversationSettings) return t('settings:contextUnlimited')
    const count = conversationSettings.contextMessageCount
    if (count === null) return t('settings:contextUnlimited')
    const options = getContextCountOptions(t)
    const option = options.find((opt) => opt.value === count)
    return option?.label || t('countMsgs', { count })
  }, [conversationSettings, t])

  // Compute system prompt label based on current settings
  const systemPromptLabel = useMemo(() => {
    if (!conversationSettings) return t('common:default')

    const { systemPromptMode, selectedSystemPromptId } = conversationSettings

    // Default mode
    if (systemPromptMode === 'none') {
      return t('common:default')
    }

    // If system prompt is set, show its name or "Custom"
    if (systemPromptMode === 'existing' && selectedSystemPromptId) {
      const prompt = prompts.find((p) => p.id === selectedSystemPromptId)
      return prompt?.name || t('common:selected')
    }

    if (systemPromptMode === 'custom') {
      return t('custom')
    }

    return t('common:default')
  }, [conversationSettings, prompts, t])

  // Get active system prompt info for tag display
  const activeSystemPromptInfo = useMemo(() => {
    if (!conversationSettings) return null

    const { systemPromptMode, selectedSystemPromptId, customSystemPrompt } = conversationSettings

    if (systemPromptMode === 'existing' && selectedSystemPromptId) {
      const prompt = prompts.find((p) => p.id === selectedSystemPromptId)
      if (prompt) {
        return { name: prompt.name, type: 'existing' as const }
      }
    }

    if (systemPromptMode === 'custom' && customSystemPrompt) {
      // Show first 20 chars of custom prompt as name
      const truncated =
        customSystemPrompt.length > 20
          ? customSystemPrompt.substring(0, 20) + '...'
          : customSystemPrompt
      return { name: truncated, type: 'custom' as const }
    }

    return null
  }, [conversationSettings, prompts])

  // Compute tools label (includes both builtin and MCP tools)
  const mcpServersLabel = useMemo(() => {
    if (!conversationSettings) return t('common:none')
    const enabledCount = conversationSettings.enabledMcpServerIds?.length || 0
    if (enabledCount === 0) return t('common:none')
    if (enabledCount === 1) {
      const tool = mcpServers.find((s) => s.id === conversationSettings.enabledMcpServerIds[0])
      return tool?.name || '1'
    }
    return `${enabledCount}`
  }, [conversationSettings, mcpServers, t])

  // Compute skills label
  const skillsLabel = useMemo(() => {
    if (!conversationSettings) return t('common:none')
    const enabledCount = conversationSettings.enabledSkillIds?.length || 0
    if (enabledCount === 0) return t('common:none')
    if (enabledCount === 1) {
      const skill = allSkills.find((s) => s.id === conversationSettings.enabledSkillIds[0])
      return skill?.name || '1'
    }
    return `${enabledCount}`
  }, [conversationSettings, allSkills, t])

  // Handler to change enabled skill IDs
  const handleSkillIdsChange = (skillIds: string[]) => {
    if (currentConversation) {
      setEnabledSkillIds(currentConversation.id, skillIds)
    }
  }

  // Handler to change enabled MCP server IDs
  const handleMcpServerIdsChange = (serverIds: string[]) => {
    if (currentConversation) {
      setEnabledMcpServerIds(currentConversation.id, serverIds)
    }
  }

  // Handler to clear system prompt
  const handleClearSystemPrompt = () => {
    if (currentConversation) {
      setSystemPrompt(currentConversation.id, 'none', null, null)
    }
  }

  // Atomic system prompt change handler
  const handleSystemPromptChange = (
    mode: PromptMode,
    promptId?: string | null,
    customContent?: string | null
  ) => {
    if (currentConversation) {
      setSystemPrompt(currentConversation.id, mode, promptId, customContent)
    }
  }

  // Handler to select working directory via native folder picker
  const handleWorkingDirectorySelect = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('selectWorkingDirectoryTitle'),
      })

      if (selected && currentConversation) {
        logger.info('Working directory selected:', selected)
        setWorkingDirectory(currentConversation.id, selected as string)
      }
    } catch (error) {
      logger.error('Failed to select working directory:', error)
    }
  }

  // Handler to clear working directory
  const handleClearWorkingDirectory = () => {
    if (currentConversation) {
      setWorkingDirectory(currentConversation.id, null)
    }
  }

  // Auto-focus textarea when conversation changes
  useEffect(() => {
    if (currentConversation && textareaRef.current) {
      // Use a small delay to ensure the component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [currentConversation])

  // Handlers for attachment types
  const handleWebPageSelect = () => {
    setIsWebPageDialogOpen(true)
  }

  const handleWebPageUrlSubmit = (url: string) => {
    addAttachment('webpage', url)
  }

  // Handlers for settings dialogs
  const handleUseProviderDefaults = () => {
    if (currentConversation) {
      setUseProviderDefaults(currentConversation.id, true)
    }
  }

  const handleSelectPreset = (presetId: string) => {
    if (currentConversation) {
      setSelectedPresetId(currentConversation.id, presetId)
    }
  }

  const handleUseCustomParameters = () => {
    if (currentConversation) {
      setUseCustomParameters(currentConversation.id, true)
    }
  }

  const handleSaveCustomParameters = (params: import('@/types').ModelParameterOverrides) => {
    if (currentConversation) {
      setParameterOverrides(currentConversation.id, params)
    }
  }

  const handleSaveContextCount = (count: number | null) => {
    if (currentConversation) {
      setContextMessageCount(currentConversation.id, count)
    }
  }

  // Get all image attachments for lightbox navigation
  const imageAttachments = attachments.filter((att) => att.type === 'image' && att.base64)
  const lightboxImages: ImageAttachmentData[] = imageAttachments.map((img) => ({
    id: img.id,
    fileName: img.name,
    base64: img.base64!,
  }))

  // Get previewing file attachment
  const previewingFile = previewingFileId
    ? attachments.find((att) => att.id === previewingFileId && att.type === 'file')
    : null

  return (
    <div
      className="grid w-full gap-6 relative"
      onDragEnter={dragHandlers.onDragEnter}
      onDragLeave={dragHandlers.onDragLeave}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
    >
      {/* Drop zone overlay */}
      <DropZoneOverlay isVisible={isDraggingOver} />

      {/* Lightbox for images */}
      {lightboxImageIndex !== null && lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxImageIndex}
          onClose={() => setLightboxImageIndex(null)}
        />
      )}

      {/* File preview dialog */}
      {previewingFile && previewingFile.content && (
        <FilePreviewDialog
          isOpen={true}
          onClose={() => setPreviewingFileId(null)}
          fileName={previewingFile.name}
          content={previewingFile.content}
          mimeType={previewingFile.mimeType}
          size={previewingFile.size}
        />
      )}

      <div className="flex flex-col gap-2">
        {/* Tags row: System Prompt + Working Directory */}
        {(activeSystemPromptInfo || conversationSettings?.workingDirectory) && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Working Directory Tag */}
            {conversationSettings?.workingDirectory && (
              <Badge
                variant="outline"
                className="hover:bg-accent transition-colors text-muted-foreground hover:text-foreground gap-1.5"
              >
                <button
                  type="button"
                  onClick={handleClearWorkingDirectory}
                  className="hover:text-destructive transition-colors -ml-0.5"
                  title={t('clearWorkingDirectory')}
                >
                  <X className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={handleWorkingDirectorySelect}
                  className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                  title={conversationSettings.workingDirectory}
                >
                  <FolderOpen className="size-3" />
                  <span className="max-w-[200px] truncate">
                    {conversationSettings.workingDirectory.split('/').pop() ||
                      conversationSettings.workingDirectory}
                  </span>
                </button>
              </Badge>
            )}

            {/* System Prompt Tag */}
            {activeSystemPromptInfo &&
              (hasMessages ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-muted-foreground gap-1.5 cursor-not-allowed opacity-70"
                    >
                      <Sparkles className="size-3" />
                      <span className="max-w-[200px] truncate">
                        {activeSystemPromptInfo.type === 'custom' ? `${t('custom')}: ` : ''}
                        {activeSystemPromptInfo.name}
                      </span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{t('systemPromptDisabledTooltip')}</TooltipContent>
                </Tooltip>
              ) : (
                <Badge
                  variant="outline"
                  className="hover:bg-accent transition-colors text-muted-foreground hover:text-foreground gap-1.5"
                >
                  <button
                    type="button"
                    onClick={handleClearSystemPrompt}
                    className="hover:text-destructive transition-colors -ml-0.5"
                    title={t('clearSystemPrompt')}
                  >
                    <X className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (currentConversation) {
                        getSettings(currentConversation.id)
                        ensurePromptsLoaded()
                      }
                      setIsSystemPromptDialogOpen(true)
                    }}
                    className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    <Sparkles className="size-3" />
                    <span className="max-w-[200px] truncate">
                      {activeSystemPromptInfo.type === 'custom' ? `${t('custom')}: ` : ''}
                      {activeSystemPromptInfo.name}
                    </span>
                  </button>
                </Badge>
              ))}
          </div>
        )}

        <InputGroup>
          <AttachmentPreviewRow
            attachments={attachments}
            onRemove={removeAttachment}
            onImageClick={setLightboxImageIndex}
            onFileClick={setPreviewingFileId}
          />
          <InputGroupTextarea
            ref={textareaRef}
            placeholder={t('typeMessage')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={!selectedModel && !selectedAssistant}
          />
          <InputToolbar
            onFileSelect={handleFileSelect}
            onImageSelect={handleImageSelect}
            onWebPageSelect={handleWebPageSelect}
            onUserPromptSelect={() => {
              cursorPositionRef.current = textareaRef.current?.selectionStart ?? null
              ensurePromptsLoaded()
              setIsUserPromptDialogOpen(true)
            }}
            isModelMenuOpen={isModelMenuOpen}
            onModelMenuOpenChange={setIsModelMenuOpen}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            isStreaming={isStreaming}
            isWaitingForAI={isWaitingForAI}
            isSending={isSending}
            canSend={!!input.trim()}
            selectedModel={selectedModel}
            selectedAssistant={selectedAssistant}
            onSend={handleSend}
            onStop={handleStop}
            onModelParametersClick={() => {
              // Ensure settings exist before opening dialog
              if (currentConversation) {
                getSettings(currentConversation.id)
              }
              setIsModelParametersDialogOpen(true)
            }}
            modelParametersLabel={modelParametersLabel}
            onContextCountClick={() => {
              // Ensure settings exist before opening dialog
              if (currentConversation) {
                getSettings(currentConversation.id)
              }
              setIsContextCountDialogOpen(true)
            }}
            contextCountLabel={contextCountLabel}
            onSystemPromptClick={() => {
              // Ensure settings exist and prompts are loaded before opening dialog
              if (currentConversation) {
                getSettings(currentConversation.id)
                ensurePromptsLoaded()
              }
              setIsSystemPromptDialogOpen(true)
            }}
            systemPromptLabel={systemPromptLabel}
            systemPromptDisabled={hasMessages}
            onMcpServersClick={() => {
              if (currentConversation) {
                getSettings(currentConversation.id)
                ensureMcpServersLoaded()
              }
              setIsMcpServersDialogOpen(true)
            }}
            mcpServersLabel={mcpServersLabel}
            onSkillsClick={() => {
              if (currentConversation) {
                getSettings(currentConversation.id)
                ensureSkillsLoaded()
              }
              setIsSkillsDialogOpen(true)
            }}
            skillsLabel={skillsLabel}
            onWorkingDirectorySelect={handleWorkingDirectorySelect}
            toolsDisabled={toolsDisabled}
            skillsDisabled={toolsDisabled}
            imageAttachDisabled={visionDisabled}
          />
        </InputGroup>
      </div>

      {/* Web Page URL Dialog */}
      <WebPageDialog
        isOpen={isWebPageDialogOpen}
        onOpenChange={setIsWebPageDialogOpen}
        onSubmit={handleWebPageUrlSubmit}
        existingAttachments={attachments}
      />

      {/* Model Parameters Dialog */}
      <ModelParametersDialog
        isOpen={isModelParametersDialogOpen}
        onOpenChange={setIsModelParametersDialogOpen}
        useProviderDefaults={conversationSettings?.useProviderDefaults ?? false}
        useCustomParameters={conversationSettings?.useCustomParameters ?? false}
        parameterOverrides={conversationSettings?.parameterOverrides ?? {}}
        selectedPresetId={conversationSettings?.selectedPresetId ?? null}
        onUseProviderDefaults={handleUseProviderDefaults}
        onSelectPreset={handleSelectPreset}
        onUseCustom={handleUseCustomParameters}
        onSaveCustomParameters={handleSaveCustomParameters}
      />

      {/* Context Count Dialog */}
      <ContextCountDialog
        isOpen={isContextCountDialogOpen}
        onOpenChange={setIsContextCountDialogOpen}
        contextMessageCount={conversationSettings?.contextMessageCount ?? null}
        onSave={handleSaveContextCount}
      />

      {/* System Prompt Dialog */}
      <SystemPromptDialog
        isOpen={isSystemPromptDialogOpen}
        onOpenChange={setIsSystemPromptDialogOpen}
        systemPromptMode={conversationSettings?.systemPromptMode ?? 'none'}
        selectedSystemPromptId={conversationSettings?.selectedSystemPromptId ?? null}
        customSystemPrompt={conversationSettings?.customSystemPrompt ?? ''}
        onSystemPromptChange={handleSystemPromptChange}
      />

      {/* User Prompt Quick Select Dialog */}
      <UserPromptQuickSelectDialog
        isOpen={isUserPromptDialogOpen}
        onOpenChange={setIsUserPromptDialogOpen}
        onSelectPrompt={(_promptId, content) => {
          const pos = cursorPositionRef.current
          if (pos !== null && input.length > 0) {
            const before = input.slice(0, pos)
            const after = input.slice(pos)
            const newInput = before + content + after
            setInput(newInput)
            const newCursorPos = pos + content.length
            requestAnimationFrame(() => {
              if (textareaRef.current) {
                textareaRef.current.focus()
                textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
              }
            })
          } else {
            setInput(content)
          }
          cursorPositionRef.current = null
        }}
      />

      {/* MCP Servers Dialog */}
      <McpServersDialog
        open={isMcpServersDialogOpen}
        onOpenChange={setIsMcpServersDialogOpen}
        enabledServerIds={conversationSettings?.enabledMcpServerIds ?? []}
        onServerIdsChange={handleMcpServerIdsChange}
        enabledSkillIds={conversationSettings?.enabledSkillIds ?? []}
        modelSupportsToolUse={capabilities.supports_tool_use}
      />

      {/* Skills Dialog */}
      <SkillsDialog
        open={isSkillsDialogOpen}
        onOpenChange={setIsSkillsDialogOpen}
        enabledSkillIds={conversationSettings?.enabledSkillIds ?? []}
        onSkillIdsChange={handleSkillIdsChange}
        modelSupportsToolUse={capabilities.supports_tool_use}
      />
    </div>
  )
}
