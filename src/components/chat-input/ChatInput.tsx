import { useState, useRef, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group'
import {
  ImageLightbox,
  FilePreviewDialog,
  type ImageAttachmentData,
} from '@/components/attachment-preview'

import { useAttachments } from './useAttachments'
import { useKeyboardHandlers } from './useKeyboardHandlers'
import { useSubmitHandler } from './useSubmitHandler'
import { AttachmentPreviewRow } from './AttachmentPreviewRow'
import { WebPageDialog } from './WebPageDialog'
import { DropZoneOverlay } from './DropZoneOverlay'
import { InputToolbar } from './InputToolbar'
import { ModelParametersDialog } from './ModelParametersDialog'
import { ContextCountDialog } from './ContextCountDialog'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { CONTEXT_COUNT_OPTIONS } from '@/types'
import type { ModelParameterPreset } from '@/types'
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

  // Auto-focus textarea when conversation changes
  useEffect(() => {
    if (currentConversation && textareaRef.current) {
      // Use a small delay to ensure the component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [currentConversation])

  // Debug: log attachments changes
  useEffect(() => {
    logger.info('[ChatInput] Attachments updated', {
      count: attachments.length,
      attachments: attachments.map((a) => ({ type: a.type, name: a.name })),
    })
  }, [attachments])

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
        />
      </InputGroup>

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
    </div>
  )
}
