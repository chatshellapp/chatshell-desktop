import { useEffect } from "react"
import { ChatInput } from "@/components/chat-input"
import { ChatMessage } from "@/components/chat-message"
import { useConversationStore } from "@/stores/conversationStore"
import { useMessageStore } from "@/stores/messageStore"
import { useModelStore } from "@/stores/modelStore"
import { useAssistantStore } from "@/stores/assistantStore"
import { useChatEvents } from "@/hooks/useChatEvents"
import type { Message } from "@/types"

// Helper function to format model name with provider
const formatModelDisplayName = (modelName: string, providerId: string, getProviderById: (id: string) => any) => {
  const provider = getProviderById(providerId)
  return provider ? `${modelName} - ${provider.name}` : modelName
}

// Global chat message configuration
const CHAT_CONFIG = {
  userMessageAlign: "right" as const,
  userMessageShowBackground: true,
}

export function ChatView() {
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)
  const messages = useMessageStore((state) => state.messages)
  const loadMessages = useMessageStore((state) => state.loadMessages)
  const isStreaming = useMessageStore((state) => state.isStreaming)
  const streamingContent = useMessageStore((state) => state.streamingContent)
  const scrapingStatus = useMessageStore((state) => state.scrapingStatus)
  const isWaitingForAI = useMessageStore((state) => state.isWaitingForAI)
  const getModelById = useModelStore((state) => state.getModelById)
  const getAssistantById = useAssistantStore((state) => state.getAssistantById)

  // Get model name for display (for currently selected model/assistant - used for streaming messages)
  const getModelDisplayName = () => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      if (!model) return selectedAssistant.name
      return `${selectedAssistant.name} · ${model.name}`
    } else if (selectedModel) {
      const getProviderById = useModelStore((state) => state.getProviderById)
      return formatModelDisplayName(selectedModel.name, selectedModel.provider_id, getProviderById)
    }
    return "AI Assistant"
  }

  // Get model info for a specific message based on its sender_id and sender_type
  const getMessageModelInfo = (message: Message): { name: string; avatar?: string } => {
    if (!message.sender_id) {
      return { name: "AI Assistant" }
    }

    // Handle different sender types
    if (message.sender_type === "model") {
      // Direct model chat
      const model = getModelById(message.sender_id)
      if (model) {
        const getProviderById = useModelStore((state) => state.getProviderById)
        return { name: formatModelDisplayName(model.name, model.provider_id, getProviderById) }
      }
    } else if (message.sender_type === "assistant") {
      // Assistant chat
      const assistant = getAssistantById(message.sender_id)
      if (assistant) {
        const assistantModel = getModelById(assistant.model_id)
        const modelName = assistantModel ? assistantModel.name : "Unknown Model"
        
        // Get assistant avatar if available
        let avatar: string | undefined
        if (assistant.avatar_type === "image") {
          avatar = assistant.avatar_image_url || assistant.avatar_image_path
        }
        
        return { 
          name: `${assistant.name} · ${modelName}`,
          avatar 
        }
      }
    }

    return { name: "AI Assistant" }
  }

  // Set up event listeners for chat streaming and scraping
  // For now, use conversationId as topicId (backward compatibility)
  useChatEvents(currentConversation?.id || null)

  // Load messages when conversation changes and cleanup on unmount
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id)
    }
    
    // Cleanup when conversation changes or component unmounts
    return () => {
      const cleanup = useMessageStore.getState().cleanup;
      cleanup();
    };
  }, [currentConversation, loadMessages])

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
            {messages.map((message) => {
              const modelInfo = getMessageModelInfo(message)
              // Map sender_type to ChatMessage role: "user" stays "user", both "model" and "assistant" become "assistant"
              const role = message.sender_type === "user" ? "user" : "assistant"
              return (
                <ChatMessage
                  key={message.id}
                  role={role}
                  content={message.content}
                  timestamp={formatTimestamp(message.created_at)}
                  modelName={modelInfo.name}
                  modelAvatar={modelInfo.avatar}
                  userMessageAlign={CHAT_CONFIG.userMessageAlign}
                  userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
                  onCopy={handleCopy}
                  onResend={handleResend}
                  onTranslate={handleTranslate}
                  onExportAll={handleExportAll}
                  onExportConversation={handleExportConversation}
                  onExportMessage={handleExportMessage}
                />
              )
            })}
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

