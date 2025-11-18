import { useEffect } from "react"
import { ChatInput } from "@/components/chat-input"
import { ChatMessage } from "@/components/chat-message"
import { useConversationStore } from "@/stores/conversationStore"
import { useMessageStore } from "@/stores/messageStore"
import { useModelStore } from "@/stores/modelStore"
import { useAssistantStore } from "@/stores/assistantStore"
import { useChatEvents } from "@/hooks/useChatEvents"
import { getModelLogo } from "@/lib/model-logos"
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
  
  // Get conversation-specific state
  const conversationState = useMessageStore((state) => 
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )
  
  const loadMessages = useMessageStore((state) => state.loadMessages)
  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const getAssistantById = useAssistantStore((state) => state.getAssistantById)

  // Extract values from conversation state with defaults
  const messages = conversationState?.messages || []
  const isStreaming = conversationState?.isStreaming || false
  const streamingContent = conversationState?.streamingContent || ''
  const scrapingStatus = conversationState?.scrapingStatus || 'idle'
  const isWaitingForAI = conversationState?.isWaitingForAI || false

  // Get model name and avatar for display (for currently selected model/assistant - used for streaming messages)
  const getModelDisplayInfo = (): { 
    name: string; 
    avatar?: string;
    avatarBg?: string;
    avatarText?: string;
    avatarType?: string;
  } => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      if (!model) return { name: selectedAssistant.name }
      
      // Return assistant avatar info based on type
      if (selectedAssistant.avatar_type === "image") {
        return { 
          name: `${selectedAssistant.name} · ${model.name}`,
          avatar: selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path,
          avatarType: "image"
        }
      } else {
        // Text/emoji avatar
        return { 
          name: `${selectedAssistant.name} · ${model.name}`,
          avatarBg: selectedAssistant.avatar_bg || undefined,
          avatarText: selectedAssistant.avatar_text || undefined,
          avatarType: "text"
        }
      }
    } else if (selectedModel) {
      return { 
        name: formatModelDisplayName(selectedModel.name, selectedModel.provider_id, getProviderById),
        avatar: getModelLogo(selectedModel)
      }
    }
    return { name: "AI Assistant" }
  }

  // Get model info for a specific message based on its sender_id and sender_type
  const getMessageModelInfo = (message: Message): { 
    name: string; 
    avatar?: string;
    avatarBg?: string;
    avatarText?: string;
    avatarType?: string;
  } => {
    if (!message.sender_id) {
      return { name: "AI Assistant" }
    }

    // Handle different sender types
    if (message.sender_type === "model") {
      // Direct model chat
      const model = getModelById(message.sender_id)
      if (model) {
        // Get model logo using the new logic
        const modelLogo = getModelLogo(model)
        return { 
          name: formatModelDisplayName(model.name, model.provider_id, getProviderById),
          avatar: modelLogo
        }
      }
    } else if (message.sender_type === "assistant") {
      // Assistant chat
      const assistant = getAssistantById(message.sender_id)
      if (assistant) {
        const assistantModel = getModelById(assistant.model_id)
        const modelName = assistantModel ? assistantModel.name : "Unknown Model"
        
        // Return assistant avatar info based on type
        if (assistant.avatar_type === "image") {
          return { 
            name: `${assistant.name} · ${modelName}`,
            avatar: assistant.avatar_image_url || assistant.avatar_image_path,
            avatarType: "image"
          }
        } else {
          // Text/emoji avatar
          return { 
            name: `${assistant.name} · ${modelName}`,
            avatarBg: assistant.avatar_bg || undefined,
            avatarText: assistant.avatar_text || undefined,
            avatarType: "text"
          }
        }
      }
    }

    return { name: "AI Assistant" }
  }

  // Set up event listeners for chat streaming and scraping
  useChatEvents(currentConversation?.id || null)

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id)
    }
  }, [currentConversation, loadMessages])

  // Cleanup conversation state on unmount (optional - could keep state cached)
  useEffect(() => {
    return () => {
      // Optionally cleanup conversation state when component unmounts
      // For now, we'll keep the state cached for better UX
      // if (currentConversation) {
      //   useMessageStore.getState().cleanupConversation(currentConversation.id);
      // }
    };
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
                  avatarBg={modelInfo.avatarBg}
                  avatarText={modelInfo.avatarText}
                  avatarType={modelInfo.avatarType}
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
            {isWaitingForAI && (() => {
              const displayInfo = getModelDisplayInfo()
              return (
                <ChatMessage
                  key="waiting"
                  role="assistant"
                  content=""
                  timestamp="Now"
                  modelName={displayInfo.name}
                  modelAvatar={displayInfo.avatar}
                  avatarBg={displayInfo.avatarBg}
                  avatarText={displayInfo.avatarText}
                  avatarType={displayInfo.avatarType}
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
              )
            })()}
            {isStreaming && streamingContent && !isWaitingForAI && (() => {
              const displayInfo = getModelDisplayInfo()
              return (
                <ChatMessage
                  key="streaming"
                  role="assistant"
                  content={streamingContent}
                  timestamp="Now"
                  modelName={displayInfo.name}
                  modelAvatar={displayInfo.avatar}
                  avatarBg={displayInfo.avatarBg}
                  avatarText={displayInfo.avatarText}
                  avatarType={displayInfo.avatarType}
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
            })()}
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
