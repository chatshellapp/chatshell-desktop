import { useEffect } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { ChatInput } from "@/components/chat-input"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ChatMessage } from "@/components/chat-message"
import { useTopicStore } from "@/stores/topicStore"
import { useMessageStore } from "@/stores/messageStore"
import { useAgentStore } from "@/stores/agentStore"
import { useModelStore } from "@/stores/modelStore"
import { useChatEvents } from "@/hooks/useChatEvents"
import { useAppInit } from "@/hooks/useAppInit"
import { SimpleSettingsDialog } from "@/components/simple-settings-dialog"

// Global chat message configuration
const CHAT_CONFIG = {
  userMessageAlign: "right" as const,
  userMessageShowBackground: true,
}

export default function Page() {
  // Initialize app (load agents, topics, settings)
  const { isInitialized, error: initError } = useAppInit()

  const currentTopic = useTopicStore((state) => state.currentTopic)
  const messages = useMessageStore((state) => state.messages)
  const loadMessages = useMessageStore((state) => state.loadMessages)
  const isStreaming = useMessageStore((state) => state.isStreaming)
  const streamingContent = useMessageStore((state) => state.streamingContent)
  const scrapingStatus = useMessageStore((state) => state.scrapingStatus)
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

  // Load messages when topic changes
  useEffect(() => {
    if (currentTopic) {
      loadMessages(currentTopic.id)
    }
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

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg">Loading ChatShell...</p>
        </div>
      </div>
    )
  }

  // Show error if initialization failed
  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg text-red-500">Failed to initialize app</p>
          <p className="text-sm text-muted-foreground">{initError}</p>
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "350px",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="flex flex-col relative">
        <header className="bg-background sticky top-0 flex shrink-0 items-center gap-2 border-b p-4 z-10">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="#">Conversations</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {currentTopic?.title || "Select a conversation"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto">
            <SimpleSettingsDialog />
          </div>
        </header>
        <div className="flex flex-1 flex-col overflow-auto pb-32">
          {messages.length === 0 && !isStreaming ? (
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
              {isStreaming && streamingContent && (
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
        <div className="bg-background border-t p-4 flex justify-center sticky bottom-0 z-10">
          <ChatInput />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
