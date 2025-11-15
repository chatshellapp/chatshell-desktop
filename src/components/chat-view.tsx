import { useEffect, useRef } from "react"
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const isAutoScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get model name for display
  const getModelDisplayName = () => {
    if (!currentAgent) return "AI Assistant"
    const model = getModelById(currentAgent.model_id)
    if (!model) return currentAgent.name
    return `${currentAgent.name} · ${model.name}`
  }

  // Helper function to check if at bottom
  const isAtBottom = () => {
    const container = scrollContainerRef.current
    if (!container) return true
    const { scrollTop, scrollHeight, clientHeight } = container
    return scrollHeight - scrollTop - clientHeight < 50
  }

  // Helper function to scroll to bottom
  const scrollToBottom = () => {
    isAutoScrollingRef.current = true
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container) {
        container.scrollTop = container.scrollHeight
      }
      // Reset flag after a short delay
      setTimeout(() => {
        isAutoScrollingRef.current = false
      }, 100)
    })
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
  
  // Auto-scroll during streaming - use instant scroll to avoid jittering
  useEffect(() => {
    if (isStreaming && streamingContent && !userScrolledRef.current) {
      scrollToBottom()
    }
  }, [isStreaming, streamingContent])
  
  // Scroll to bottom when new messages arrive (user sent message or AI replied)
  useEffect(() => {
    if (messages.length > 0) {
      // Always scroll to bottom on new messages, and reset user scroll flag
      userScrolledRef.current = false
      scrollToBottom()
    }
  }, [messages.length])
  
  // Detect if user manually scrolled (only count user-initiated scrolls)
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    const handleScroll = () => {
      // Ignore scroll events triggered by auto-scroll
      if (isAutoScrollingRef.current) {
        return
      }
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // Debounce: check position after user stops scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        // If user is at bottom, enable auto-scroll
        if (isAtBottom()) {
          userScrolledRef.current = false
        } else {
          // User scrolled away from bottom
          userScrolledRef.current = true
        }
      }, 100)
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

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
      <div ref={scrollContainerRef} className="flex flex-1 flex-col overflow-auto pb-6">
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-background border-t p-4 flex justify-center sticky bottom-0 z-10">
        <ChatInput />
      </div>
    </div>
  )
}

