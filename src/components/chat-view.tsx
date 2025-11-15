import { useEffect } from "react"
import { ChatInput } from "@/components/chat-input"
import { ChatMessage } from "@/components/chat-message"
import { useTopicStore } from "@/stores/topicStore"
import { useMessageStore } from "@/stores/messageStore"
import { useAgentStore } from "@/stores/agentStore"
import { useModelStore } from "@/stores/modelStore"
import { useChatEvents } from "@/hooks/useChatEvents"

// Global chat message configuration
const CHAT_CONFIG = {
  userMessageAlign: "right" as const,
  userMessageShowBackground: true,
}

export function ChatView() {
  const currentTopic = useTopicStore((state) => state.currentTopic)
  const messages = useMessageStore((state) => state.messages)
  const loadMessages = useMessageStore((state) => state.loadMessages)
  const isStreaming = useMessageStore((state) => state.isStreaming)
  const streamingContent = useMessageStore((state) => state.streamingContent)
  const scrapingStatus = useMessageStore((state) => state.scrapingStatus)
  const isWaitingForAI = useMessageStore((state) => state.isWaitingForAI)
  const currentAgent = useAgentStore((state) => state.currentAgent)
  const getModelById = useModelStore((state) => state.getModelById)

  // Get model name for display
  const getModelDisplayName = () => {
    if (!currentAgent) return "AI Assistant"
    const model = getModelById(currentAgent.model_id)
    if (!model) return currentAgent.name
    return `${currentAgent.name} · ${model.name}`
  }

  // Set up event listeners for chat streaming and scraping
  useChatEvents(currentTopic?.id || null)

  // Load messages when topic changes and cleanup on unmount
  useEffect(() => {
    if (currentTopic) {
      loadMessages(currentTopic.id)
    }
    
    // Cleanup when topic changes or component unmounts
    return () => {
      const cleanup = useMessageStore.getState().cleanup;
      cleanup();
    };
  }, [currentTopic, loadMessages])

  const handleCopy = () => {
    console.log("Message copied")
  }

  const handleResend = () => {
    console.log("Resend message")
  }

  const handleTranslate = () => {
    console.log("Translate message")
  }

  const handleExportAll = () => {
    console.log("Export all messages")
  }

  const handleExportConversation = () => {
    console.log("Export current conversation")
  }

  const handleExportMessage = () => {
    console.log("Export current message")
  }

  // Format timestamp from ISO string
  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString()
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Messages Area */}
      <div className="flex flex-1 flex-col overflow-auto">
        {messages.length === 0 && !isStreaming && !isWaitingForAI ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No messages yet. Start a conversation!</p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role as "user" | "assistant"}
                content={message.content}
                timestamp={formatTimestamp(message.created_at)}
                modelName={getModelDisplayName()}
                userMessageAlign={CHAT_CONFIG.userMessageAlign}
                userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
                onCopy={handleCopy}
                onResend={handleResend}
                onTranslate={handleTranslate}
                onExportAll={handleExportAll}
                onExportConversation={handleExportConversation}
                onExportMessage={handleExportMessage}
              />
            ))}
            {isWaitingForAI && (
              <ChatMessage
                key="waiting"
                role="assistant"
                content=""
                timestamp="Now"
                modelName={getModelDisplayName()}
                userMessageAlign={CHAT_CONFIG.userMessageAlign}
                userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
                isLoading={true}
                onCopy={handleCopy}
                onResend={handleResend}
                onTranslate={handleTranslate}
                onExportAll={handleExportAll}
                onExportConversation={handleExportConversation}
                onExportMessage={handleExportMessage}
              />
            )}
            {isStreaming && streamingContent && !isWaitingForAI && (
              <ChatMessage
                key="streaming"
                role="assistant"
                content={streamingContent}
                timestamp="Now"
                modelName={getModelDisplayName()}
                userMessageAlign={CHAT_CONFIG.userMessageAlign}
                userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
                onCopy={handleCopy}
                onResend={handleResend}
                onTranslate={handleTranslate}
                onExportAll={handleExportAll}
                onExportConversation={handleExportConversation}
                onExportMessage={handleExportMessage}
              />
            )}
          </>
        )}
        {scrapingStatus === 'scraping' && (
          <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
            <span>Fetching webpage content...</span>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="bg-background border-t p-4 flex justify-center sticky bottom-0 z-10">
        <ChatInput />
      </div>
    </div>
  )
}

