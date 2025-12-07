import {
  ArrowUpIcon,
  Plus,
  FileText,
  Image,
  Sparkles,
  BookOpen,
  Plug,
  Globe,
  Square,
  Settings2,
  Search,
  Package,
  Upload,
} from 'lucide-react'
import React, { useState, useRef, useEffect } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  ImageLightbox,
  FilePreviewDialog,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { useConversationStore } from '@/stores/conversationStore'
import { useMessageStore } from '@/stores/message'
import { useModelStore } from '@/stores/modelStore'
import type { Model } from '@/types'

import { useAttachments } from './useAttachments'
import { ModelSelectorDropdown } from './ModelSelectorDropdown'
import { AttachmentPreviewRow } from './AttachmentPreviewRow'
import { WebPageDialog } from './WebPageDialog'

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

  // Store hooks - use granular selectors to avoid unnecessary re-renders
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)

  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)

  // Get conversation-specific state
  const conversationState = useMessageStore((state) =>
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )
  const sendMessage = useMessageStore((state) => state.sendMessage)
  const stopGeneration = useMessageStore((state) => state.stopGeneration)
  const isSending = useMessageStore((state) => state.isSending)

  // Get streaming state from current conversation
  const isStreaming = conversationState?.isStreaming || false
  const isWaitingForAI = conversationState?.isWaitingForAI || false

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
    console.log(
      '[ChatInput] Attachments updated:',
      attachments.length,
      attachments.map((a) => ({ type: a.type, name: a.name }))
    )
  }, [attachments])

  const handlePromptSelect = () => {
    console.log('Prompt selected')
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

  const handleSend = async () => {
    console.log('handleSend called', {
      input: input.trim(),
      hasCurrentConversation: !!currentConversation,
      selectedModel: selectedModel?.name,
      selectedAssistant: selectedAssistant?.name,
    })

    if (!input.trim()) {
      console.warn('Cannot send: empty input')
      return
    }

    // Check if we have either a model or assistant selected
    if (!selectedModel && !selectedAssistant) {
      alert('Please select a model or assistant first')
      return
    }

    // Determine which model to use
    let modelToUse: Model | undefined
    let providerType: string
    let modelIdStr: string

    if (selectedAssistant) {
      // Use assistant's model
      modelToUse = getModelById(selectedAssistant.model_id)
      if (!modelToUse) {
        console.error('Model not found for assistant:', selectedAssistant.model_id)
        alert('Error: Model configuration not found for assistant')
        return
      }
    } else if (selectedModel) {
      // Use selected model directly
      modelToUse = selectedModel
    } else {
      alert('Please select a model or assistant first')
      return
    }

    // Get provider info
    const provider = getProviderById(modelToUse.provider_id)
    if (!provider) {
      console.error('Provider not found for model:', modelToUse.provider_id)
      alert('Error: Provider configuration not found')
      return
    }

    providerType = provider.provider_type
    modelIdStr = modelToUse.model_id

    const content = input.trim()
    setInput('')

    try {
      // Get API credentials from provider
      const apiKey: string | undefined = provider.api_key
      const baseUrl: string | undefined = provider.base_url

      // Get prompts from assistant if selected
      let systemPrompt: string | undefined
      let userPrompt: string | undefined

      if (selectedAssistant) {
        systemPrompt = selectedAssistant.system_prompt
        userPrompt = selectedAssistant.user_prompt || undefined
        console.log('Using assistant prompts:', {
          hasSystemPrompt: !!systemPrompt,
          hasUserPrompt: !!userPrompt,
        })
      }

      // Extract file attachments as structured data (sent via rig's Document)
      const fileAttachments = attachments.filter((att) => att.type === 'file' && att.content)
      const files = fileAttachments.map((file) => ({
        name: file.name,
        content: file.content!,
        mimeType: file.mimeType || 'text/plain',
      }))

      // Extract image attachments with filename
      const imageAttachments = attachments.filter((att) => att.type === 'image' && att.base64)
      const images = imageAttachments.map((img) => ({
        name: img.name,
        base64: img.base64!,
        mimeType: img.mimeType || 'image/png',
      }))

      console.log('Sending message:', {
        content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        conversationId: currentConversation?.id,
        provider: providerType,
        model: modelIdStr,
        hasApiKey: !!apiKey,
        baseUrl,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        modelDbId: selectedAssistant ? undefined : modelToUse.id,
        assistantDbId: selectedAssistant?.id,
        selectedAssistant: selectedAssistant?.name,
        selectedModel: selectedModel?.name,
        modelToUse: modelToUse?.name,
        fileAttachmentsCount: files.length,
        imagesCount: images.length,
      })

      // Extract webpage URLs from attachments
      const webpageUrls = attachments.filter((att) => att.type === 'webpage').map((att) => att.name)

      await sendMessage(
        content, // Send original content, files are sent separately
        currentConversation?.id ?? null,
        providerType,
        modelIdStr,
        apiKey,
        baseUrl,
        undefined, // includeHistory
        systemPrompt,
        userPrompt,
        selectedAssistant ? undefined : modelToUse.id, // modelDbId - only send if not using assistant
        selectedAssistant?.id, // assistantDbId
        webpageUrls.length > 0 ? webpageUrls : undefined, // urlsToFetch
        images.length > 0 ? images : undefined, // images
        files.length > 0 ? files : undefined, // files
        webSearchEnabled // searchEnabled
      )

      // Clear attachments after sending
      clearAttachments()

      console.log('Message sent successfully')
    } catch (error) {
      console.error('Failed to send message:', error)
      alert(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStop = async () => {
    if (!currentConversation) {
      console.warn('Cannot stop: no current conversation')
      return
    }

    console.log('handleStop called for conversation:', currentConversation.id)

    try {
      await stopGeneration(currentConversation.id)
      console.log('Generation stopped successfully')
    } catch (error) {
      console.error('Failed to stop generation:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition keys have keyCode 229
    // This is the most reliable way to detect IME input
    if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
      return // Let IME handle the input
    }

    // Command+Enter or Ctrl+Enter: insert new line manually
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = input.substring(0, start) + '\n' + input.substring(end)
      setInput(newValue)

      // Set cursor position after the inserted newline
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1
      }, 0)
      return
    }

    // Enter without modifiers: send message
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      handleSend()
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
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="size-8" />
            <span className="text-sm font-medium">Drop files here</span>
            <span className="text-xs text-muted-foreground">Documents or Images</span>
          </div>
        </div>
      )}

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
        <InputGroupAddon align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="outline" className="rounded-full" size="icon-xs">
                <Plus />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem]">
              <DropdownMenuItem onClick={handleWebPageSelect} className="gap-2">
                <Globe className="size-4" />
                <span>Web Page</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFileSelect} className="gap-2">
                <FileText className="size-4" />
                <span>Document</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImageSelect} className="gap-2">
                <Image className="size-4" />
                <span>Image</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="outline" className="rounded-full" size="icon-xs">
                <Settings2 />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem] min-w-[180px]"
            >
              <DropdownMenuItem
                className="gap-2 justify-between"
                onSelect={(e) => e.preventDefault()}
              >
                <div className="flex items-center gap-2">
                  <Search className="size-4" />
                  <span>Web Search</span>
                </div>
                <Switch checked={webSearchEnabled} onCheckedChange={setWebSearchEnabled} />
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 justify-between"
                onSelect={(e) => e.preventDefault()}
              >
                <div className="flex items-center gap-2">
                  <Package className="size-4" />
                  <span>Artifacts</span>
                </div>
                <Switch checked={artifactsEnabled} onCheckedChange={setArtifactsEnabled} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePromptSelect} className="gap-2">
                <Sparkles className="size-4" />
                <span>Prompt</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleKnowledgeBaseSelect} className="gap-2">
                <BookOpen className="size-4" />
                <span>Knowledge</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToolSelect} className="gap-2">
                <Plug className="size-4" />
                <span>Tools</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ModelSelectorDropdown
            isOpen={isModelMenuOpen}
            onOpenChange={setIsModelMenuOpen}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
          />
          <div className="ml-auto flex items-center gap-1.5">
            {/* <CircleProgress percentage={56} size={20} />
            <span className="text-xs text-muted-foreground">56.0%</span> */}
          </div>
          <Separator orientation="vertical" className="!h-4" />
          {isStreaming || isWaitingForAI ? (
            <InputGroupButton
              variant="default"
              className="rounded-full"
              size="icon-xs"
              onClick={handleStop}
            >
              <Square className="size-3 fill-current" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              className="rounded-full"
              size="icon-xs"
              disabled={!input.trim() || (!selectedModel && !selectedAssistant) || isSending}
              onClick={handleSend}
            >
              <ArrowUpIcon />
              <span className="sr-only">Send</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
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

