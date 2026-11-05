import { memo, useCallback } from 'react'
import { SiblingNavigator } from '@/components/chat-view/SiblingNavigator'
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
import { ProducedFilesRow } from './ProducedFilesRow'
import { deriveProducedFiles } from '@/lib/produced-files'
import { MarkdownContent } from '@/components/markdown-content'
import type { Message, ContextEnrichment, ProcessStep, UrlStatus } from '@/types'
import { isContentBlock, isThinkingStep, isToolCall, getDisplayOrder } from '@/types/process-step'
import type { MessageResources } from '@/types/message-resources'
import {
  countRunSteps,
  groupOrderedSteps,
  splitRunItems,
  type GroupedItem,
} from '@/lib/step-grouping'
import { RunFold, savedRunStatus } from './RunFold'
import { CHAT_CONFIG, formatTimestamp } from './utils'
import type { DisplayInfo } from './hooks'
import { GeneratedImageGallery } from './GeneratedImageGallery'
import { RunOutcomeFooter } from './FailedTurn'
import type { RunOutcome } from '@/stores/message/types'

/**
 * Rough height placeholder for a row that has never rendered (CJK/latin
 * mixed ≈ 24px per 40 chars, plus row chrome). Only read before first paint;
 * the `auto` keyword then keeps the last-rendered real height.
 */
function rowExtentEstimate(content: string): number {
  return Math.round(Math.min(6000, 96 + (Math.min(content.length, 8000) / 40) * 24))
}

interface MessageItemProps {
  message: Message
  /** Previous message in the window; assistant items read the prior user
   * message's resources from it. Null at the window head. */
  prevUserMessage: Message | null
  /** Session-only outcome of a reply that failed or was stopped mid-run. */
  runOutcome?: RunOutcome
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  getMessageDisplayInfo: (message: Message) => DisplayInfo
  onCopy: () => void
  onRevert: (messageId: string) => void
  onDeleteFromHere: (messageId: string) => void
  onRegenerate: (messageId: string) => void
  onFork: (messageId: string) => void
  onExportAll: () => void
  onExportConversation: (messageId: string) => void
  onExportMessage: (messageId: string) => void
}

/**
 * Re-render only when the data this row actually reads changes: its own
 * message identity, the previous user message it pulls resources from, the
 * per-message slices of the shared resource/status maps (the map objects
 * themselves get new identities whenever ANY message updates), or one of the
 * stable callbacks (R1.1/R1.2).
 */
function messageItemPropsEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.message !== next.message) return false
  if (prev.prevUserMessage !== next.prevUserMessage) return false
  if (prev.runOutcome !== next.runOutcome) return false
  if (prev.getMessageDisplayInfo !== next.getMessageDisplayInfo) return false
  if (
    prev.onCopy !== next.onCopy ||
    prev.onRevert !== next.onRevert ||
    prev.onDeleteFromHere !== next.onDeleteFromHere ||
    prev.onRegenerate !== next.onRegenerate ||
    prev.onFork !== next.onFork ||
    prev.onExportAll !== next.onExportAll ||
    prev.onExportConversation !== next.onExportConversation ||
    prev.onExportMessage !== next.onExportMessage
  ) {
    return false
  }
  if (prev.messageResources[prev.message.id] !== next.messageResources[next.message.id]) {
    return false
  }
  const prevResourceId = prev.prevUserMessage?.id
  const nextResourceId = next.prevUserMessage?.id
  if (prevResourceId !== nextResourceId) return false
  if (
    prevResourceId !== undefined &&
    prev.messageResources[prevResourceId] !== next.messageResources[prevResourceId]
  ) {
    return false
  }
  if (prev.urlStatuses[prev.message.id] !== next.urlStatuses[next.message.id]) return false
  if (
    prevResourceId !== undefined &&
    prev.urlStatuses[prevResourceId] !== next.urlStatuses[prevResourceId]
  ) {
    return false
  }
  return true
}

export const MessageItem = memo(function MessageItem({
  message,
  prevUserMessage,
  runOutcome,
  messageResources,
  urlStatuses,
  getMessageDisplayInfo,
  onCopy,
  onRevert,
  onDeleteFromHere,
  onRegenerate,
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
  if (isAssistantMessage && prevUserMessage) {
    prevUserMessageId = prevUserMessage.id
    const prevResources = messageResources[prevUserMessage.id] || {
      attachments: [],
      contexts: [],
      steps: [],
    }
    // Only show search_result - fetch_results from search are shown inside SearchResultPreview
    contextsToShow = prevResources.contexts.filter((c) => c.type === 'search_result')
    // Show search decisions from previous user message
    searchDecisionSteps = prevResources.steps.filter((s) => s.type === 'search_decision')
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

  // Group steps (thinking attached to tool calls), then split the run: the
  // process up to the last tool call folds, the answer after it does not.
  const groupedSteps = groupOrderedSteps(orderedSteps)
  const hasGroupedSteps = groupedSteps.length > 0
  const run = splitRunItems(groupedSteps)
  const runCounts = countRunSteps(run.fold)
  const runStatus = savedRunStatus(
    runOutcome,
    run.fold.flatMap((item) => (item.kind === 'tool' ? [item.data.toolCall.status] : []))
  )
  const hasAssistantResources = contextsToShow.length > 0 || searchDecisionSteps.length > 0

  // Stable per-row callbacks so memo(ChatMessage) can bail out when this
  // item re-renders for a reason that does not change its own content.
  const messageId = message.id
  const handleRevertClick = useCallback(() => onRevert(messageId), [onRevert, messageId])
  const handleDeleteFromHereClick = useCallback(
    () => onDeleteFromHere(messageId),
    [onDeleteFromHere, messageId]
  )
  const handleForkClick = useCallback(() => onFork(messageId), [onFork, messageId])
  const handleExportConversationClick = useCallback(
    () => onExportConversation(messageId),
    [onExportConversation, messageId]
  )
  const handleExportMessageClick = useCallback(
    () => onExportMessage(messageId),
    [onExportMessage, messageId]
  )
  const handleRegenerateClick = useCallback(
    () => onRegenerate(messageId),
    [onRegenerate, messageId]
  )

  const renderStep = (item: GroupedItem) => {
    switch (item.kind) {
      case 'tool':
        return (
          <div key={item.id} className="space-y-1.5">
            {item.data.thinkingContent && <ThinkingPreview content={item.data.thinkingContent} />}
            <ToolCallPreview toolCall={item.data.toolCall} />
          </div>
        )
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
  }

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
        {run.fold.length > 0 && (
          <RunFold
            foldKey={message.id}
            live={false}
            status={runStatus}
            steps={runCounts.steps}
            failedTools={runCounts.failedTools}
          >
            {run.fold.map(renderStep)}
          </RunFold>
        )}
        {run.after.map(renderStep)}
      </div>
    ) : undefined

  const userAfterContent = isUserMessage ? (
    <>
      {hasUserAttachments && (
        <div className="flex justify-end my-1">
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
      {message.conversation_id && (
        <div className="flex justify-end mt-0.5">
          <SiblingNavigator conversationId={message.conversation_id} messageId={message.id} />
        </div>
      )}
    </>
  ) : undefined

  const producedFiles = isAssistantMessage
    ? deriveProducedFiles(resources.steps.filter(isToolCall))
    : []

  const footerContent =
    assistantImageAttachments.length > 0 || runOutcome || producedFiles.length > 0 ? (
      <>
        {producedFiles.length > 0 && <ProducedFilesRow files={producedFiles} />}
        {assistantImageAttachments.length > 0 && (
          <GeneratedImageGallery attachments={assistantImageAttachments} />
        )}
        {runOutcome && <RunOutcomeFooter outcome={runOutcome} onRetry={handleRegenerateClick} />}
      </>
    ) : undefined

  const handleCopyImage = useCallback(async () => {
    if (assistantImageAttachments.length === 0) return
    const firstImage = assistantImageAttachments[0]
    await invoke('copy_image_to_clipboard', {
      storagePath: firstImage.storage_path,
      base64Data: null,
    })
  }, [assistantImageAttachments])

  const handleCopyContentBlocks = useCallback(
    async () => navigator.clipboard.writeText(message.content),
    [message.content]
  )

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
    <div
      key={message.id}
      id={`message-${message.id}`}
      data-message-id={message.id}
      style={{
        // Viewport culling: off-screen rows skip layout/paint (they stay
        // mounted, so state and search-jump survive). Without it, scrolling a
        // long history outpaces the webview's tile rasterization and unpainted
        // regions flash white. The estimate only applies before the row's
        // first render; `auto` then pins the last-rendered height.
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${rowExtentEstimate(message.content)}px`,
      }}
    >
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
        headerExtras={
          isAssistantMessage && message.conversation_id ? (
            <SiblingNavigator conversationId={message.conversation_id} messageId={message.id} />
          ) : undefined
        }
        footerContent={footerContent}
        userAfterContent={userAfterContent}
        onCopyOverride={
          assistantImageAttachments.length > 0
            ? handleCopyImage
            : hasContentBlocks
              ? handleCopyContentBlocks
              : undefined
        }
        onCopy={onCopy}
        onRevert={handleRevertClick}
        onDeleteFromHere={handleDeleteFromHereClick}
        onRegenerate={isAssistantMessage ? handleRegenerateClick : undefined}
        onFork={handleForkClick}
        onDownloadMarkdown={handleDownloadMarkdown}
        onExportAll={onExportAll}
        onExportConversation={handleExportConversationClick}
        onExportMessage={handleExportMessageClick}
      />
    </div>
  )
}, messageItemPropsEqual)
