import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { logger } from '@/lib/logger'
import { ChatMessage } from '@/components/chat-message'
import {
  AttachmentPreview,
  ThinkingPreview,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { ToolCallPreview } from '@/components/attachment-preview/tool-call-preview'
import { CollapsedToolGroup } from '@/components/attachment-preview/collapsed-tool-group'
import { MarkdownContent } from '@/components/markdown-content'
import type { Message, ContextEnrichment, ProcessStep, UrlStatus } from '@/types'
import { isContentBlock, isThinkingStep, isToolCall, getDisplayOrder } from '@/types/process-step'
import type { MessageResources } from '@/types/message-resources'
import { groupOrderedSteps } from '@/lib/step-grouping'
import { CHAT_CONFIG, formatTimestamp } from './utils'
import type { DisplayInfo } from './hooks'
import { GeneratedImageGallery } from './GeneratedImageGallery'

interface MessageItemProps {
  message: Message
  messages: Message[]
  index: number
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  getMessageDisplayInfo: (message: Message) => DisplayInfo
  onCopy: () => void
  onRevert: (messageId: string) => void
  onFork: (messageId: string) => void
  onExportAll: () => void
  onExportConversation: () => void
  onExportMessage: (messageId: string) => void
}

export function MessageItem({
  message,
  messages,
  index,
  messageResources,
  urlStatuses,
  getMessageDisplayInfo,
  onCopy,
  onRevert,
  onFork,
  onExportAll,
  onExportConversation,
  onExportMessage,
}: MessageItemProps) {
  const info = getMessageDisplayInfo(message)
  // Map sender_type to ChatMessage role: "user" stays "user", both "model" and "assistant" become "assistant"
  const role = message.sender_type === 'user' ? 'user' : 'assistant'
  const isUserMessage = message.sender_type === 'user'
  const isAssistantMessage = !isUserMessage

  // Get resources for this message
  const resources = messageResources[message.id] || {
    attachments: [],
    contexts: [],
    steps: [],
  }

  // Separate user vs assistant attachments
  const userAttachments = isUserMessage ? resources.attachments : []
  const assistantImageAttachments = isAssistantMessage
    ? resources.attachments.filter((a) => a.type === 'file' && a.mime_type?.startsWith('image/'))
    : []

  // Get fetch results for user message - only user-initiated ones (not from search)
  // Search-initiated fetch results should be shown inside SearchResultPreview
  const userFetchResults = isUserMessage
    ? resources.contexts.filter((c) => c.type === 'fetch_result' && c.source_type !== 'search')
    : []

  // Check if this message has a search result (URLs will be shown inside it)
  const hasSearchResult = resources.contexts.some((c) => c.type === 'search_result')
  const messageUrlStatuses = hasSearchResult ? undefined : urlStatuses[message.id]
  const urls = messageUrlStatuses ? Object.keys(messageUrlStatuses) : []

  const hasUserAttachments =
    isUserMessage && (userAttachments.length > 0 || userFetchResults.length > 0 || urls.length > 0)

  // For assistant messages in history, get context and steps from previous user message
  let contextsToShow: ContextEnrichment[] = []
  let searchDecisionSteps: ProcessStep[] = []
  let prevUserMessageId: string | null = null
  if (isAssistantMessage && index > 0) {
    const prevMessage = messages[index - 1]
    if (prevMessage.sender_type === 'user') {
      prevUserMessageId = prevMessage.id
      const prevResources = messageResources[prevMessage.id] || {
        attachments: [],
        contexts: [],
        steps: [],
      }
      // Only show search_result - fetch_results from search are shown inside SearchResultPreview
      contextsToShow = prevResources.contexts.filter((c) => c.type === 'search_result')
      // Show search decisions from previous user message
      searchDecisionSteps = prevResources.steps.filter((s) => s.type === 'search_decision')
    }
  }

  // Check if we have content blocks for interleaved display
  const hasContentBlocks = resources.steps.some(isContentBlock)

  // Get steps that should be displayed in order (thinking, tool calls, content blocks)
  // At same display_order, thinking steps appear before content blocks
  const orderedSteps = resources.steps
    .filter((s) => isThinkingStep(s) || isToolCall(s) || isContentBlock(s))
    .sort((a, b) => {
      const orderDiff = getDisplayOrder(a) - getDisplayOrder(b)
      if (orderDiff !== 0) return orderDiff
      if (isThinkingStep(a) && !isThinkingStep(b)) return -1
      if (!isThinkingStep(a) && isThinkingStep(b)) return 1
      return 0
    })

  // Group steps: attach thinking to tool calls, collapse consecutive completed tool calls
  const groupedSteps = groupOrderedSteps(orderedSteps)
  const hasGroupedSteps = groupedSteps.length > 0
  const hasAssistantResources = contextsToShow.length > 0 || searchDecisionSteps.length > 0

  // Unified header content for assistant messages
  const headerContent =
    isAssistantMessage && (hasAssistantResources || hasGroupedSteps) ? (
      <div className="space-y-1.5 mb-2">
        {/* Search decisions first (from previous user message) */}
        {searchDecisionSteps.map((step) => (
          <AttachmentPreview key={step.id} step={step} />
        ))}
        {/* Search results (from previous user message) */}
        {contextsToShow.map((context) => (
          <AttachmentPreview
            key={context.id}
            context={context}
            urlStatuses={
              context.type === 'search_result' && prevUserMessageId
                ? urlStatuses[prevUserMessageId]
                : undefined
            }
            messageId={prevUserMessageId ?? undefined}
          />
        ))}
        {/* Grouped steps: tool calls (with merged thinking), collapsed groups, content blocks */}
        {groupedSteps.map((item) => {
          switch (item.kind) {
            case 'tool':
              return (
                <div key={item.id} className="space-y-1.5">
                  {item.data.thinkingContent && (
                    <ThinkingPreview content={item.data.thinkingContent} />
                  )}
                  <ToolCallPreview toolCall={item.data.toolCall} />
                  {item.data.trailingThinkingContent && (
                    <ThinkingPreview content={item.data.trailingThinkingContent} />
                  )}
                </div>
              )
            case 'tool-group':
              return <CollapsedToolGroup key={item.id} items={item.items} />
            case 'content':
              return (
                <div
                  key={item.id}
                  className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none"
                >
                  <MarkdownContent content={item.content} />
                </div>
              )
            case 'thinking':
              return <ThinkingPreview key={item.id} content={item.content} />
          }
        })}
      </div>
    ) : undefined

  const generatedImagesContent =
    assistantImageAttachments.length > 0 ? (
      <GeneratedImageGallery attachments={assistantImageAttachments} />
    ) : undefined

  const handleCopyImage = useCallback(async () => {
    if (assistantImageAttachments.length === 0) return
    const firstImage = assistantImageAttachments[0]
    await invoke('copy_image_to_clipboard', {
      storagePath: firstImage.storage_path,
      base64Data: null,
    })
  }, [assistantImageAttachments])

  const handleDownloadMarkdown = useCallback(async () => {
    try {
      const now = new Date()
      const y = now.getFullYear()
      const m = String(now.getMonth() + 1).padStart(2, '0')
      const d = String(now.getDate()).padStart(2, '0')
      const chars = 'abcdefghijklmnopqrstuvwxyz'
      let suffix = ''
      for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
      const defaultPath = `chatshell-${y}${m}${d}-${suffix}.md`

      const filePath = await save({
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (filePath) {
        await writeTextFile(filePath, message.content)
      }
    } catch (err) {
      logger.error('Failed to save markdown file:', err)
    }
  }, [message.content])

  return (
    <div key={message.id} id={`message-${message.id}`} data-message-id={message.id}>
      <ChatMessage
        role={role}
        content={hasContentBlocks ? '' : message.content}
        timestamp={formatTimestamp(message.created_at)}
        displayName={info.displayName}
        senderType={info.senderType}
        modelLogo={info.modelLogo}
        assistantLogo={info.assistantLogo}
        avatarBg={info.avatarBg}
        avatarText={info.avatarText}
        assistantName={info.assistantName}
        assistantRole={info.assistantRole}
        assistantDescription={info.assistantDescription}
        assistantModelName={info.assistantModelName}
        assistantModelId={info.assistantModelId}
        userMessageAlign={CHAT_CONFIG.userMessageAlign}
        userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
        headerContent={headerContent}
        footerContent={generatedImagesContent}
        onCopyOverride={
          assistantImageAttachments.length > 0
            ? handleCopyImage
            : hasContentBlocks
              ? async () => {
                  navigator.clipboard.writeText(message.content)
                }
              : undefined
        }
        onCopy={onCopy}
        onRevert={() => onRevert(message.id)}
        onFork={() => onFork(message.id)}
        onDownloadMarkdown={handleDownloadMarkdown}
        onExportAll={onExportAll}
        onExportConversation={onExportConversation}
        onExportMessage={() => onExportMessage(message.id)}
      />

      {/* User attachments - rendered right-aligned after user message */}
      {hasUserAttachments && (
        <div className="flex justify-end px-4 my-1">
          <div className="max-w-[80%] space-y-1.5">
            {(() => {
              const imageAttachments = userAttachments.filter(
                (a) => a.type === 'file' && a.mime_type?.startsWith('image/')
              )
              const allImages: ImageAttachmentData[] = imageAttachments.map((a) => ({
                id: a.id,
                fileName: a.file_name,
                storagePath: a.storage_path,
              }))

              return userAttachments.map((attachment) => {
                const isImage =
                  attachment.type === 'file' && attachment.mime_type?.startsWith('image/')
                const imageIndex = isImage
                  ? imageAttachments.findIndex((img) => img.id === attachment.id)
                  : undefined

                return (
                  <AttachmentPreview
                    key={attachment.id}
                    userAttachment={attachment}
                    allImages={isImage ? allImages : undefined}
                    currentImageIndex={imageIndex}
                  />
                )
              })
            })()}
            {userFetchResults.map((context) => (
              <AttachmentPreview key={context.id} context={context} />
            ))}
            {urls.map((url) => (
              <AttachmentPreview key={url} processingUrl={url} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
