import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ChatInput } from "@/components/chat-input"
import { ChatMessage } from "@/components/chat-message"
import { AttachmentPreview } from "@/components/attachment-preview"
import { useConversationStore } from "@/stores/conversationStore"
import { useMessageStore } from "@/stores/messageStore"
import { useModelStore } from "@/stores/modelStore"
import { useAssistantStore } from "@/stores/assistantStore"
import { useChatEvents } from "@/hooks/useChatEvents"
import { getModelLogo } from "@/lib/model-logos"
import type { Message, Attachment } from "@/types"

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

  // Ref for auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  
  // Track if user is at bottom
  const [isAtBottom, setIsAtBottom] = useState(true)
  
  // Track input area height for button positioning
  const [inputAreaHeight, setInputAreaHeight] = useState(0)
  
  // Track messages content container position for button centering
  const [buttonLeft, setButtonLeft] = useState<string | number>('50%')

  // Track if user is actively scrolling (user scroll lock)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number | null>(null)

  // Extract values from conversation state with defaults
  const messages = conversationState?.messages || []
  const isStreaming = conversationState?.isStreaming || false
  const streamingContent = conversationState?.streamingContent || ''
  const attachmentStatus = conversationState?.attachmentStatus || 'idle'
  const isWaitingForAI = conversationState?.isWaitingForAI || false
  const processingUrls = conversationState?.processingUrls || {}

  // Store attachments for each message (keyed by message id)
  const [messageAttachments, setMessageAttachments] = useState<Record<string, Attachment[]>>({})

  // Get display info for currently selected model/assistant (used for streaming messages)
  const getDisplayInfo = (): { 
    displayName: string; 
    senderType: "model" | "assistant";
    modelLogo?: string;
    assistantLogo?: string;
    avatarBg?: string;
    avatarText?: string;
  } => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      const modelName = model ? model.name : "Unknown Model"
      
      // Return assistant info
      if (selectedAssistant.avatar_type === "image") {
        return { 
          displayName: `${selectedAssistant.name} · ${modelName}`,
          senderType: "assistant",
          assistantLogo: selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path
        }
      } else {
        // Text/emoji avatar
        return { 
          displayName: `${selectedAssistant.name} · ${modelName}`,
          senderType: "assistant",
          avatarBg: selectedAssistant.avatar_bg || undefined,
          avatarText: selectedAssistant.avatar_text || undefined
        }
      }
    } else if (selectedModel) {
      return { 
        displayName: formatModelDisplayName(selectedModel.name, selectedModel.provider_id, getProviderById),
        senderType: "model",
        modelLogo: getModelLogo(selectedModel)
      }
    }
    return { displayName: "AI Assistant", senderType: "model" }
  }

  // Get display info for a specific message based on its sender_id and sender_type
  const getMessageDisplayInfo = (message: Message): { 
    displayName: string; 
    senderType: "model" | "assistant";
    modelLogo?: string;
    assistantLogo?: string;
    avatarBg?: string;
    avatarText?: string;
  } => {
    if (!message.sender_id) {
      return { displayName: "AI Assistant", senderType: "model" }
    }

    // Handle different sender types
    if (message.sender_type === "model") {
      // Direct model chat
      const model = getModelById(message.sender_id)
      if (model) {
        return { 
          displayName: formatModelDisplayName(model.name, model.provider_id, getProviderById),
          senderType: "model",
          modelLogo: getModelLogo(model)
        }
      }
    } else if (message.sender_type === "assistant") {
      // Assistant chat
      const assistant = getAssistantById(message.sender_id)
      if (assistant) {
        const assistantModel = getModelById(assistant.model_id)
        const modelName = assistantModel ? assistantModel.name : "Unknown Model"
        
        // Return assistant info
        if (assistant.avatar_type === "image") {
          return { 
            displayName: `${assistant.name} · ${modelName}`,
            senderType: "assistant",
            assistantLogo: assistant.avatar_image_url || assistant.avatar_image_path
          }
        } else {
          // Text/emoji avatar
          return { 
            displayName: `${assistant.name} · ${modelName}`,
            senderType: "assistant",
            avatarBg: assistant.avatar_bg || undefined,
            avatarText: assistant.avatar_text || undefined
          }
        }
      }
    }

    return { displayName: "AI Assistant", senderType: "model" }
  }

  // Set up event listeners for chat streaming and scraping
  useChatEvents(currentConversation?.id || null)

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id)
    }
  }, [currentConversation, loadMessages])

  // Fetch attachments for user messages
  // Re-run when attachmentStatus changes to 'complete' to pick up newly processed attachments
  useEffect(() => {
    const fetchAttachments = async () => {
      const userMessages = messages.filter(m => m.sender_type === "user")
      const attachmentMap: Record<string, Attachment[]> = {}
      
      for (const msg of userMessages) {
        // When processing just completed, always re-fetch for the latest message
        // Otherwise, skip if we already have attachments for this message
        const isLatestMessage = userMessages.indexOf(msg) === userMessages.length - 1
        const shouldRefetch = attachmentStatus === 'complete' && isLatestMessage
        
        if (messageAttachments[msg.id] && !shouldRefetch) {
          attachmentMap[msg.id] = messageAttachments[msg.id]
          continue
        }
        
        try {
          const attachments = await invoke<Attachment[]>("get_message_attachments", {
            messageId: msg.id
          })
          if (attachments.length > 0) {
            attachmentMap[msg.id] = attachments
          }
        } catch (e) {
          console.error("Failed to fetch attachments for message:", msg.id, e)
        }
      }
      
      // Only update if there are changes
      if (Object.keys(attachmentMap).length > 0) {
        setMessageAttachments(prev => ({ ...prev, ...attachmentMap }))
      }
    }
    
    if (messages.length > 0) {
      fetchAttachments()
    }
  }, [messages, attachmentStatus])

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

  // Measure input area height and update on resize
  useEffect(() => {
    const inputArea = inputAreaRef.current
    if (!inputArea) return

    // Initial measurement
    const updateHeight = () => {
      setInputAreaHeight(inputArea.offsetHeight)
    }
    
    updateHeight()

    // Use ResizeObserver to watch for height changes
    const resizeObserver = new ResizeObserver(() => {
      updateHeight()
    })

    resizeObserver.observe(inputArea)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Calculate button position based on messages content container
  useEffect(() => {
    const updateButtonPosition = () => {
      const messagesContent = messagesContentRef.current
      if (!messagesContent) {
        setButtonLeft('50%')
        return
      }

      const rect = messagesContent.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      setButtonLeft(centerX)
    }

    updateButtonPosition()

    // Update on window resize
    window.addEventListener('resize', updateButtonPosition)
    // Update on scroll (in case layout shifts)
    const container = messagesContainerRef.current
    if (container) {
      container.addEventListener('scroll', updateButtonPosition)
    }

    return () => {
      window.removeEventListener('resize', updateButtonPosition)
      if (container) {
        container.removeEventListener('scroll', updateButtonPosition)
      }
    }
  }, [messages.length, isAtBottom])

  // Check if user is near bottom (within 100px threshold)
  const checkIfAtBottom = () => {
    const container = messagesContainerRef.current
    if (!container) return true
    
    const threshold = 100
    const isNearBottom = 
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold
    
    return isNearBottom
  }

  // Handle scroll events to track user position
  const handleScroll = () => {
    // Mark that user is actively scrolling
    isUserScrollingRef.current = true
    
    // Clear any existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    // Set a timeout to mark scroll as finished (user stopped scrolling)
    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false
      // Update position only after user stops scrolling
      setIsAtBottom(checkIfAtBottom())
    }, 150) // 150ms debounce - adjust if needed
  }

  // Auto-scroll to bottom ONLY if user is at bottom AND not actively scrolling
  useEffect(() => {
    // Don't auto-scroll if user is actively scrolling
    if (isUserScrollingRef.current) {
      return
    }
    
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages.length, streamingContent, isStreaming, isWaitingForAI, isAtBottom])

  // Reset to bottom when conversation changes
  useEffect(() => {
    if (currentConversation) {
      setIsAtBottom(true)
      isUserScrollingRef.current = false
    }
  }, [currentConversation?.id])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4"
        onScroll={handleScroll}
      >
        {messages.length === 0 && !isStreaming && !isWaitingForAI ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No messages yet. Start a conversation!</p>
          </div>
        ) : (
          <div ref={messagesContentRef} className="max-w-4xl mx-auto py-4">
            {messages.map((message) => {
              const info = getMessageDisplayInfo(message)
              // Map sender_type to ChatMessage role: "user" stays "user", both "model" and "assistant" become "assistant"
              const role = message.sender_type === "user" ? "user" : "assistant"
              const isUserMessage = message.sender_type === "user"
              // Filter for web fetch_result attachments (similar to previous webpage filtering)
              const attachments = messageAttachments[message.id]?.filter(a => 
                a.origin === "web" && a.attachment_type === "fetch_result"
              ) || []
              const urls = processingUrls[message.id] || []
              const hasAttachments = isUserMessage && (attachments.length > 0 || urls.length > 0)
              
              return (
                <div key={message.id}>
                  <ChatMessage
                    role={role}
                    content={message.content}
                    timestamp={formatTimestamp(message.created_at)}
                    displayName={info.displayName}
                    senderType={info.senderType}
                    modelLogo={info.modelLogo}
                    assistantLogo={info.assistantLogo}
                    avatarBg={info.avatarBg}
                    avatarText={info.avatarText}
                    userMessageAlign={CHAT_CONFIG.userMessageAlign}
                    userMessageShowBackground={CHAT_CONFIG.userMessageShowBackground}
                    onCopy={handleCopy}
                    onResend={handleResend}
                    onTranslate={handleTranslate}
                    onExportAll={handleExportAll}
                    onExportConversation={handleExportConversation}
                    onExportMessage={handleExportMessage}
                  />
                  {/* Attachment previews - rendered as separate message block */}
                  {hasAttachments && (
                    <div className="flex justify-end px-4 my-1">
                      <div className="max-w-[80%] space-y-1.5">
                        {attachments.map((attachment) => (
                          <AttachmentPreview key={attachment.id} attachment={attachment} />
                        ))}
                        {urls.map((url) => (
                          <AttachmentPreview key={url} processingUrl={url} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {isWaitingForAI && (() => {
              const info = getDisplayInfo()
              return (
                <ChatMessage
                  key="waiting"
                  role="assistant"
                  content=""
                  timestamp="Now"
                  displayName={info.displayName}
                  senderType={info.senderType}
                  modelLogo={info.modelLogo}
                  assistantLogo={info.assistantLogo}
                  avatarBg={info.avatarBg}
                  avatarText={info.avatarText}
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
              const info = getDisplayInfo()
              return (
                <ChatMessage
                  key="streaming"
                  role="assistant"
                  content={streamingContent}
                  timestamp="Now"
                  displayName={info.displayName}
                  senderType={info.senderType}
                  modelLogo={info.modelLogo}
                  assistantLogo={info.assistantLogo}
                  avatarBg={info.avatarBg}
                  avatarText={info.avatarText}
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
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        )}
        
      </div>

      {/* Scroll to bottom button - fixed positioning relative to viewport */}
      <div 
        className={`fixed z-20 pointer-events-none transition-opacity duration-150 ease-in-out ${
          !isAtBottom ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ 
          bottom: `${inputAreaHeight + 16}px`,
          left: typeof buttonLeft === 'number' ? `${buttonLeft}px` : buttonLeft,
          transform: typeof buttonLeft === 'number' ? 'translateX(-50%)' : '-translate-x-1/2'
        }}
      >
        <button
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
            setIsAtBottom(true)
          }}
          className={`bg-muted text-muted-foreground px-2.5 py-1 rounded-full shadow-sm hover:bg-muted/90 transition-colors flex items-center gap-1.5 pointer-events-auto text-xs ${
            !isAtBottom ? '' : 'pointer-events-none'
          }`}
        >
          <span className="text-sm">↓</span>
          <span>New messages</span>
        </button>
      </div>

      {/* Input Area */}
      <div 
        ref={inputAreaRef}
        className="shrink-0 bg-background border-t p-4 flex justify-center"
      >
        <ChatInput />
      </div>
    </div>
  )
}
