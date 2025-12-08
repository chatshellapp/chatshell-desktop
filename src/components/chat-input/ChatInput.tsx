import { useState, useRef, useEffect } from 'react'
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
import { logger } from '@/lib/logger'

interface ChatInputProps {}

export function ChatInput({}: ChatInputProps) {
  // State
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState<'models' | 'assistants'>('models')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [artifactsEnabled, setArtifactsEnabled] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isWebPageDialogOpen, setIsWebPageDialogOpen] = useState(false)
  // Preview state for attachments
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null)
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number | null>(null)
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
  const handlePromptSelect = () => {
    logger.info('Prompt selected')
  }

  const handleKnowledgeBaseSelect = () => {
    addAttachment('knowledge', 'Documentation')
  }

  const handleToolSelect = () => {
    addAttachment('tools', 'Calculator')
  }

  const handleWebPageSelect = () => {
    setIsWebPageDialogOpen(true)
  }

  const handleWebPageUrlSubmit = (url: string) => {
    addAttachment('webpage', url)
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
          onPromptSelect={handlePromptSelect}
          onKnowledgeBaseSelect={handleKnowledgeBaseSelect}
          onToolSelect={handleToolSelect}
          webSearchEnabled={webSearchEnabled}
          onWebSearchEnabledChange={setWebSearchEnabled}
          artifactsEnabled={artifactsEnabled}
          onArtifactsEnabledChange={setArtifactsEnabled}
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
        />
      </InputGroup>

      {/* Web Page URL Dialog */}
      <WebPageDialog
        isOpen={isWebPageDialogOpen}
        onOpenChange={setIsWebPageDialogOpen}
        onSubmit={handleWebPageUrlSubmit}
        existingAttachments={attachments}
      />
    </div>
  )
}
