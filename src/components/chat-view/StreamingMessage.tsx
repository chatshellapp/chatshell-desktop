import { useState, useMemo } from 'react'
import { useStreamingState } from './hooks/useStreamingState'
import { ChatMessage } from '@/components/chat-message'
import {
  AttachmentPreview,
  ThinkingPreview,
  ImageLightbox,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import { ToolCallPreview } from '@/components/attachment-preview/tool-call-preview'
import { MarkdownContent } from '@/components/markdown-content'
import { parseThinkingContent } from '@/lib/utils'
import { liveRunFoldKey } from '@/stores/runFoldStore'
import type { Message, UrlStatus } from '@/types'
import type { MessageResources } from '@/types/message-resources'
import { CHAT_CONFIG } from './utils'
import type { DisplayInfo } from './hooks'
import { useTranslation } from 'react-i18next'
import { WaitingForResponse } from './WaitingForResponse'
import { RunFold } from './RunFold'

interface StreamingMessageProps {
  conversationId: string
  /** Last user message of the loaded window; assistant resources hang off it. */
  lastUserMessage: Message | null
  messageResources: Record<string, MessageResources>
  urlStatuses: Record<string, Record<string, UrlStatus>>
  getDisplayInfo: () => DisplayInfo
  onCopy: () => void
  onExportAll: () => void
  onExportConversation: () => void
  onExportMessage: () => void
}

export function StreamingMessage({
  conversationId,
  lastUserMessage,
  messageResources,
  urlStatuses,
  getDisplayInfo,
  onCopy,
  onExportAll,
  onExportConversation,
  onExportMessage,
}: StreamingMessageProps) {
  const { t } = useTranslation('chat')
  const {
    streamingContent,
    streamingReasoningContent,
    isReasoningActive,
    isWaitingForAI,
    isStreaming,
    streamingToolCalls,
    streamingImages,
    pendingSearchDecisions,
  } = useStreamingState(conversationId)
  const info = getDisplayInfo()

  // Parse thinking content from streaming output (XML tags like <think>)
  const parsedStreaming = isWaitingForAI
    ? { content: '', thinkingContent: null, isThinkingInProgress: false }
    : parseThinkingContent(streamingContent)

  // Combine API-provided reasoning (GPT-5, Gemini) with XML-parsed thinking
  // API reasoning takes precedence as it's the native format for reasoning models
  const combinedThinkingContent = streamingReasoningContent || parsedStreaming.thinkingContent
  const isThinkingInProgress =
    isStreaming && (streamingReasoningContent ? true : parsedStreaming.isThinkingInProgress)

  // Get resources for the last user message (passed in by the parent; the
  // parent already searched the low-frequency messages window)

  // Build headerContent with contexts, steps, and thinking preview
  let streamingHeaderContent: React.ReactNode = undefined
  const lastUserResources = lastUserMessage
    ? messageResources[lastUserMessage.id] || {
        attachments: [],
        contexts: [],
        steps: [],
      }
    : { attachments: [], contexts: [], steps: [] }

  // Only get search results - fetch results from search are shown inside SearchResultPreview
  const searchResultContexts = lastUserResources.contexts.filter((c) => c.type === 'search_result')
  // Get search decisions from steps
  const searchDecisionSteps = lastUserResources.steps.filter((s) => s.type === 'search_decision')

  const hasPendingDecision = lastUserMessage ? pendingSearchDecisions[lastUserMessage.id] : false
  const hasAssistantResources = searchResultContexts.length > 0 || searchDecisionSteps.length > 0
  const hasStreamingToolCalls = Object.keys(streamingToolCalls).length > 0

  // Show thinking when reasoning has actually started (received first reasoning chunk)
  // This provides visual feedback that reasoning models (GPT-5, o1, etc.) are actively thinking
  // Note: We only show thinking when:
  // 1. isReasoningActive is true (not during the initial waiting phase)
  // 2. Search decision process is resolved - either:
  //    - No pending decision was started, OR
  //    - The search decision step has been loaded
  // This ensures the "Deciding if web search is needed..." / "No search needed" UI
  // appears BEFORE the thinking placeholder
  const searchDecisionResolved = !hasPendingDecision || searchDecisionSteps.length > 0
  const showThinkingPlaceholder = isReasoningActive && searchDecisionResolved

  // Sort tool calls by order for proper display
  const sortedToolCalls = Object.values(streamingToolCalls).sort((a, b) => a.order - b.order)

  // Check if we have interleaved content (tool calls with content or reasoning before them)
  const hasInterleavedContent =
    hasStreamingToolCalls &&
    sortedToolCalls.some(
      (tc) =>
        (tc.contentBefore && tc.contentBefore.length > 0) ||
        (tc.reasoningBefore && tc.reasoningBefore.length > 0)
    )

  // Calculate the content to display after all tool calls
  let finalContent = parsedStreaming.content
  if (hasInterleavedContent && sortedToolCalls.length > 0) {
    const lastToolCall = sortedToolCalls[sortedToolCalls.length - 1]
    const lastContentLength = lastToolCall.contentBefore?.length || 0
    if (streamingContent.length > lastContentLength) {
      const rawSegment = streamingContent.slice(lastContentLength)
      const parsed = parseThinkingContent(rawSegment)
      finalContent = parsed.content
    } else {
      finalContent = ''
    }
  }

  // Process steps in display order: thinking, tool calls, and text between
  // tool calls. With a tool call they sit under the live run fold; a
  // thinking-only run keeps its own collapsible thinking block.
  const processElements: React.ReactNode[] = []
  let thinkingBlocks = 0

  if (hasInterleavedContent) {
    for (let index = 0; index < sortedToolCalls.length; index++) {
      const toolCall = sortedToolCalls[index]

      // API reasoning that arrived since the previous tool call
      let reasoningSegment = ''
      if (index === 0) {
        reasoningSegment = toolCall.reasoningBefore || ''
      } else {
        const prevReasoningLength = sortedToolCalls[index - 1].reasoningBefore?.length || 0
        if ((toolCall.reasoningBefore?.length || 0) > prevReasoningLength) {
          reasoningSegment = (toolCall.reasoningBefore || '').slice(prevReasoningLength)
        }
      }

      // Text since the previous tool call, with any XML thinking extracted
      let contentSegment = ''
      let xmlThinkingSegment: string | null = null
      const prevContentLength =
        index === 0 ? 0 : sortedToolCalls[index - 1].contentBefore?.length || 0
      const currentContentLength = toolCall.contentBefore?.length || 0
      if (currentContentLength > prevContentLength) {
        const rawSegment = (toolCall.contentBefore || '').slice(prevContentLength)
        const parsed = parseThinkingContent(rawSegment)
        contentSegment = parsed.content
        xmlThinkingSegment = parsed.thinkingContent
      }

      const thinkingParts = [reasoningSegment, xmlThinkingSegment].filter(
        (p): p is string => !!p && p.trim().length > 0
      )
      const thinkingContent = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
      const showThinking = !!thinkingContent && searchDecisionResolved
      if (showThinking) thinkingBlocks += 1

      if (contentSegment.trim()) {
        processElements.push(
          <div
            key={`content-${index}`}
            className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none"
          >
            <MarkdownContent content={contentSegment} />
          </div>
        )
      }

      processElements.push(
        <div key={toolCall.id} className="space-y-2">
          {showThinking && <ThinkingPreview content={thinkingContent} isStreaming={false} />}
          <ToolCallPreview
            streamingToolCall={toolCall}
            isStreaming={
              isStreaming && (toolCall.status === 'running' || toolCall.status === 'pending')
            }
          />
        </div>
      )
    }

    // Reasoning/thinking after the last tool call
    const lastToolCall = sortedToolCalls[sortedToolCalls.length - 1]
    const lastReasoningLength = lastToolCall?.reasoningBefore?.length || 0
    if (streamingReasoningContent.length > lastReasoningLength) {
      const remainingReasoning = streamingReasoningContent.slice(lastReasoningLength)
      if (remainingReasoning.trim() && searchDecisionResolved) {
        thinkingBlocks += 1
        processElements.push(
          <ThinkingPreview
            key="remaining-api-reasoning"
            content={remainingReasoning}
            isStreaming={isThinkingInProgress}
          />
        )
      }
    }
    const lastContentLength = lastToolCall?.contentBefore?.length || 0
    if (streamingContent.length > lastContentLength) {
      const parsed = parseThinkingContent(streamingContent.slice(lastContentLength))
      if (parsed.thinkingContent?.trim() && searchDecisionResolved) {
        thinkingBlocks += 1
        processElements.push(
          <ThinkingPreview
            key="remaining-xml-thinking"
            content={parsed.thinkingContent}
            isStreaming={parsed.isThinkingInProgress}
          />
        )
      }
    }
  } else {
    // Show the thinking placeholder while waiting, or actual content when
    // available; only once the search decision is resolved.
    if (searchDecisionResolved && (showThinkingPlaceholder || combinedThinkingContent)) {
      thinkingBlocks += 1
      processElements.push(
        <ThinkingPreview
          key="thinking"
          content={combinedThinkingContent || ''}
          isStreaming={showThinkingPlaceholder || isThinkingInProgress}
        />
      )
    }
    for (const toolCall of sortedToolCalls) {
      processElements.push(
        <ToolCallPreview
          key={toolCall.id}
          streamingToolCall={toolCall}
          isStreaming={
            isStreaming && (toolCall.status === 'running' || toolCall.status === 'pending')
          }
        />
      )
    }
  }

  if (hasAssistantResources || hasPendingDecision || processElements.length > 0) {
    streamingHeaderContent = (
      <div className="space-y-1.5 mb-2">
        {hasPendingDecision && searchDecisionSteps.length === 0 && (
          <AttachmentPreview pendingSearchDecision={true} />
        )}
        {searchDecisionSteps.map((step) => (
          <AttachmentPreview key={step.id} step={step} />
        ))}
        {/* Search results (fetch results from search are shown inside) */}
        {searchResultContexts.map((context) => (
          <AttachmentPreview
            key={context.id}
            context={context}
            urlStatuses={lastUserMessage ? urlStatuses[lastUserMessage.id] : undefined}
            messageId={lastUserMessage?.id}
          />
        ))}
        {hasStreamingToolCalls ? (
          <RunFold
            foldKey={liveRunFoldKey(conversationId)}
            live={true}
            status="running"
            steps={sortedToolCalls.length + thinkingBlocks}
            failedTools={sortedToolCalls.filter((tc) => tc.status === 'error').length}
          >
            {processElements}
          </RunFold>
        ) : (
          processElements
        )}
      </div>
    )
  }

  // Only show content when:
  // 1. Not waiting for AI, AND
  // 2. Search decision is resolved (no pending decision, or decision step exists)
  // This ensures the "No search needed" UI appears BEFORE the response content
  const showContent = !isWaitingForAI && searchDecisionResolved

  const contentWithImages = showContent ? finalContent : ''

  const streamingImageData: ImageAttachmentData[] = useMemo(
    () =>
      streamingImages.map((url, i) => ({
        id: `streaming-${i}`,
        fileName: `generated-image-${i + 1}.png`,
        base64: url,
      })),
    [streamingImages]
  )

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const streamingImagesContent =
    streamingImageData.length > 0 ? (
      <div className="flex flex-wrap gap-3 mt-3">
        {streamingImageData.map((img, index) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            className="cursor-pointer rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
          >
            <img
              src={img.base64}
              alt={img.fileName}
              className="max-w-full md:max-w-[512px] h-auto rounded-lg shadow-sm"
              loading="lazy"
            />
          </button>
        ))}
        {lightboxIndex !== null && (
          <ImageLightbox
            images={streamingImageData}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </div>
    ) : null

  return (
    <ChatMessage
      key={isWaitingForAI ? 'waiting' : 'streaming'}
      role="assistant"
      content={contentWithImages}
      timestamp={t('now')}
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
      isLoading={isWaitingForAI || !searchDecisionResolved}
      loadingContent={isWaitingForAI ? <WaitingForResponse /> : undefined}
      isStreaming={isStreaming}
      headerContent={streamingHeaderContent}
      footerContent={streamingImagesContent}
      onCopy={onCopy}
      onExportAll={onExportAll}
      onExportConversation={onExportConversation}
      onExportMessage={onExportMessage}
    />
  )
}
