import { useState, useRef, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group'
import {
  ImageLightbox,
  FilePreviewDialog,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { X, Sparkles } from 'lucide-react'

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
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/promptStore'
import { useMessageStore } from '@/stores/message'
import { CONTEXT_COUNT_OPTIONS } from '@/types'
import type { ModelParameterPreset, PromptMode } from '@/types'
import { logger } from '@/lib/logger'

interface ChatInputProps {}

export function ChatInput({}: ChatInputProps) {
  // State
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState<'models' | 'assistants'>('models')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isWebPageDialogOpen, setIsWebPageDialogOpen] = useState(false)
  const [isModelParametersDialogOpen, setIsModelParametersDialogOpen] = useState(false)
  const [isContextCountDialogOpen, setIsContextCountDialogOpen] = useState(false)
  const [isSystemPromptDialogOpen, setIsSystemPromptDialogOpen] = useState(false)
  const [isUserPromptDialogOpen, setIsUserPromptDialogOpen] = useState(false)
  // Preview state for attachments
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null)
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number | null>(null)
  // Parameter presets for displaying names
  const [parameterPresets, setParameterPresets] = useState<ModelParameterPreset[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
  } = useAttachments()

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
    webSearchEnabled,
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

  // Prompt store for getting prompt names
  const { prompts, ensureLoaded: ensurePromptsLoaded } = usePromptStore()

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
    if (!conversationSettings) return 'Default'
    if (conversationSettings.useProviderDefaults) return 'Default'
    if (conversationSettings.useCustomParameters) return 'Custom'
    if (conversationSettings.selectedPresetId) {
      const preset = parameterPresets.find((p) => p.id === conversationSettings.selectedPresetId)
      return preset?.name || 'Preset'
    }
    // No explicit selection - show Default (will use assistant preset if available)
    return 'Default'
  }, [conversationSettings, parameterPresets])

  const contextCountLabel = useMemo(() => {
    if (!conversationSettings) return 'Unlimited'
    const count = conversationSettings.contextMessageCount
    if (count === null) return 'Unlimited'
    const option = CONTEXT_COUNT_OPTIONS.find((opt) => opt.value === count)
    return option?.label || `${count} msgs`
  }, [conversationSettings])

  // Compute system prompt label based on current settings
  const systemPromptLabel = useMemo(() => {
    if (!conversationSettings) return 'Default'

    const { systemPromptMode, selectedSystemPromptId } = conversationSettings

    // Default mode
    if (systemPromptMode === 'none') {
      return 'Default'
    }

    // If system prompt is set, show its name or "Custom"
    if (systemPromptMode === 'existing' && selectedSystemPromptId) {
      const prompt = prompts.find((p) => p.id === selectedSystemPromptId)
      return prompt?.name || 'Selected'
    }

    if (systemPromptMode === 'custom') {
      return 'Custom'
    }

    return 'Default'
  }, [conversationSettings, prompts])

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
      const truncated = customSystemPrompt.length > 20 
        ? customSystemPrompt.substring(0, 20) + '...' 
        : customSystemPrompt
      return { name: truncated, type: 'custom' as const }
    }

    return null
  }, [conversationSettings, prompts])

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
        {/* System Prompt Tag */}
        {activeSystemPromptInfo && (
          <div className="flex items-center gap-2">
            {hasMessages ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="text-muted-foreground gap-1.5 cursor-not-allowed opacity-70"
                  >
                    <Sparkles className="size-3" />
                    <span className="max-w-[200px] truncate">
                      {activeSystemPromptInfo.type === 'custom' ? 'Custom: ' : ''}
                      {activeSystemPromptInfo.name}
                    </span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  System prompt can only be changed when conversation is empty
                </TooltipContent>
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
                  title="Clear system prompt"
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
                    {activeSystemPromptInfo.type === 'custom' ? 'Custom: ' : ''}
                    {activeSystemPromptInfo.name}
                  </span>
                </button>
              </Badge>
            )}
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
          placeholder="Ask, Search or Chat..."
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
            ensurePromptsLoaded()
            setIsUserPromptDialogOpen(true)
          }}
          webSearchEnabled={webSearchEnabled}
          onWebSearchEnabledChange={setWebSearchEnabled}
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
          // Set the prompt content directly to the input
          setInput(content)
        }}
      />
    </div>
  )
}
