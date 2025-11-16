import { ArrowUpIcon, Paperclip, File, Image, Sparkles, BookOpen, Plug, Globe, X } from "lucide-react"
import React, { useState, useRef } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useTopicStore } from "@/stores/topicStore"
import { useMessageStore } from "@/stores/messageStore"
import { useAssistantStore } from "@/stores/assistantStore"
import { useModelStore } from "@/stores/modelStore"
import { useSettingsStore } from "@/stores/settingsStore"
import type { Topic, Assistant, Model } from "@/types"

type AttachmentType = "webpage" | "file" | "image" | "knowledge" | "tools"

interface Attachment {
  id: string
  type: AttachmentType
  name: string
}

interface ChatInputProps {}

// Circle progress component
interface CircleProgressProps {
  percentage: number
  size?: number
}

function CircleProgress({ percentage, size = 24 }: CircleProgressProps) {
  const strokeWidth = 2.5
  const radius = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference

  return (
    <svg
      width={size}
      height={size}
      className="transform -rotate-90"
    >
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={cn(
          "transition-all duration-300 ease-out",
          percentage < 70 ? "text-green-500" : percentage < 90 ? "text-yellow-500" : "text-red-500"
        )}
      />
    </svg>
  )
}

// Helper function to get icon for attachment type
function getAttachmentIcon(type: AttachmentType, isHovered: boolean = false) {
  if (isHovered) {
    return <X className="h-3 w-3" />
  }
  
  switch (type) {
    case "webpage":
      return <Globe className="h-3 w-3" />
    case "file":
      return <File className="h-3 w-3" />
    case "image":
      return <Image className="h-3 w-3" />
    case "knowledge":
      return <BookOpen className="h-3 w-3" />
    case "tools":
      return <Plug className="h-3 w-3" />
  }
}

export function ChatInput({}: ChatInputProps) {
  // State
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [hoveredBadgeId, setHoveredBadgeId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"models" | "assistants">("models")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Store hooks
  const currentTopic = useTopicStore((state: any) => state.currentTopic) as Topic | null
  const currentAssistant = useAssistantStore((state: any) => state.currentAssistant) as Assistant | null
  const assistants = useAssistantStore((state: any) => state.assistants) as Assistant[]
  const setCurrentAssistant = useAssistantStore((state: any) => state.setCurrentAssistant)
  const updateAssistant = useAssistantStore((state: any) => state.updateAssistant)
  const models = useModelStore((state: any) => state.models) as Model[]
  const getModelById = useModelStore((state: any) => state.getModelById)
  const getProviderById = useModelStore((state: any) => state.getProviderById)
  const sendMessage = useMessageStore((state: any) => state.sendMessage)
  const isSending = useMessageStore((state: any) => state.isSending) as boolean
  const getSetting = useSettingsStore((state: any) => state.getSetting)

  // Debug: Log when component mounts
  React.useEffect(() => {
    console.log('=== ChatInput component mounted ===')
    console.log('Current topic:', currentTopic)
    console.log('Current assistant:', currentAssistant)
  }, [])

  // Debug: Log when topic or assistant changes
  React.useEffect(() => {
    console.log('=== State changed ===')
    console.log('Current topic:', currentTopic)
    console.log('Current assistant:', currentAssistant)
  }, [currentTopic, currentAssistant])

  // URL regex pattern to detect URLs (handles URLs within sentences)
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)/g

  const handlePromptSelect = () => {
    console.log("Prompt selected")
  }

  const addAttachment = (type: AttachmentType, name: string) => {
    const newAttachment: Attachment = {
      id: `${type}-${Date.now()}`,
      type,
      name,
    }
    setAttachments([...attachments, newAttachment])
  }

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter(att => att.id !== id))
  }

  const handleFileSelect = () => {
    // In a real implementation, this would open a file picker
    addAttachment("file", "example-document.pdf")
  }

  const handleImageSelect = () => {
    // In a real implementation, this would open an image picker
    addAttachment("image", "example-image.png")
  }

  const handleKnowledgeBaseSelect = () => {
    // In a real implementation, this would open a knowledge base selector
    addAttachment("knowledge", "Documentation")
  }

  const handleToolSelect = () => {
    // In a real implementation, this would open a tools selector
    addAttachment("tools", "Calculator")
  }

  const handleWebPageSelect = () => {
    // In a real implementation, this would open a URL input dialog
    addAttachment("webpage", "https://example.com")
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData("text")
    const urls = pastedText.match(urlRegex)
    
    if (urls && urls.length > 0) {
      // Add each detected URL as a webpage attachment
      urls.forEach((url) => {
        // Check if this URL is not already in attachments
        const isDuplicate = attachments.some(
          att => att.type === "webpage" && att.name === url
        )
        if (!isDuplicate) {
          addAttachment("webpage", url)
        }
      })
    }
  }

  const handleSend = async () => {
    console.log("handleSend called", {
      input: input.trim(),
      hasCurrentTopic: !!currentTopic,
      hasCurrentAssistant: !!currentAssistant,
      currentTopic,
      currentAssistant
    })

    if (!input.trim() || !currentTopic || !currentAssistant) {
      console.warn("Cannot send: missing input, topic, or assistant")
      return
    }

    // Get model info from assistant's model_id
    const model = getModelById(currentAssistant.model_id)
    if (!model) {
      console.error("Model not found for assistant:", currentAssistant.model_id)
      alert("Error: Model configuration not found")
      return
    }

    // Get provider info from model's provider_id
    const provider = getProviderById(model.provider_id)
    if (!provider) {
      console.error("Provider not found for model:", model.provider_id)
      alert("Error: Provider configuration not found")
      return
    }

    const content = input.trim()
    setInput("")

    try {
      // Use provider's configuration, fall back to settings for backward compatibility
      let apiKey: string | undefined = provider.api_key
      let baseUrl: string | undefined = provider.base_url

      // Fall back to settings if not in provider
      if (!apiKey && provider.provider_type === "openai") {
        apiKey = (await getSetting("openai_api_key")) || undefined
      } else if (!apiKey && provider.provider_type === "openrouter") {
        apiKey = (await getSetting("openrouter_api_key")) || undefined
      }
      
      if (!baseUrl && provider.provider_type === "ollama") {
        baseUrl = (await getSetting("ollama_base_url")) || "http://localhost:11434"
      }

      console.log("Sending message:", {
        content,
        topicId: currentTopic.id,
        provider: provider.provider_type,
        model: model.model_id,
        hasApiKey: !!apiKey,
        baseUrl
      })

      // Note: provider and model parameters are kept for backward compatibility
      // Backend now fetches provider/model info from database via agent
      await sendMessage(
        content,
        currentTopic.id,
        provider.provider_type,
        model.model_id,
        apiKey,
        baseUrl
      )

      console.log("Message sent successfully")
    } catch (error) {
      console.error("Failed to send message:", error)
      console.error("Error details:", {
        error,
        errorString: String(error),
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })
      
      // Show error to user
      alert(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleModelSelect = async (modelId: string) => {
    if (!currentAssistant) return

    try {
      await updateAssistant(currentAssistant.id, {
        name: currentAssistant.name,
        system_prompt: currentAssistant.system_prompt,
        model_id: modelId,
        avatar_bg: currentAssistant.avatar_bg,
        avatar_text: currentAssistant.avatar_text,
        is_starred: currentAssistant.is_starred,
      })
      console.log('Model updated successfully for assistant:', currentAssistant.name)
    } catch (error) {
      console.error('Failed to update assistant model:', error)
      alert(`Failed to update model: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleAssistantSelect = (assistant: Assistant) => {
    setCurrentAssistant(assistant)
    console.log('Assistant selected:', assistant.name)
  }


  return (
    <div className="grid w-full gap-6">
      <InputGroup>
        {attachments.length > 0 && (
          <div className="order-first w-full flex flex-wrap gap-2 px-3 pt-3 pb-0">
            {attachments.map((attachment) => (
              <Badge
                key={attachment.id}
                variant="outline"
                className="cursor-pointer hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                onMouseEnter={() => setHoveredBadgeId(attachment.id)}
                onMouseLeave={() => setHoveredBadgeId(null)}
                onClick={() => removeAttachment(attachment.id)}
              >
                {getAttachmentIcon(attachment.type, hoveredBadgeId === attachment.id)}
                <span>{attachment.name}</span>
              </Badge>
            ))}
          </div>
        )}
        <InputGroupTextarea 
          ref={textareaRef}
          placeholder="Ask, Search or Chat..." 
          value={input}
          onChange={(e) => {
            console.log('📝 Input changed:', e.target.value)
            setInput(e.target.value)
          }}
          onKeyDown={(e) => {
            console.log('⌨️ Key pressed:', e.key)
            handleKeyDown(e)
          }}
          onPaste={handlePaste}
          disabled={!currentTopic || !currentAssistant}
        />
        <InputGroupAddon align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton
                variant="outline"
                className="rounded-full"
                size="icon-xs"
              >
                <Paperclip />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem]"
            >
              <DropdownMenuItem onClick={handleWebPageSelect} className="gap-2">
                <Globe className="h-4 w-4" />
                <span>Web Page</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFileSelect} className="gap-2">
                <File className="h-4 w-4" />
                <span>File</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImageSelect} className="gap-2">
                <Image className="h-4 w-4" />
                <span>Image</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePromptSelect} className="gap-2">
                <Sparkles className="h-4 w-4" />
                <span>Prompt</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleKnowledgeBaseSelect} className="gap-2">
                <BookOpen className="h-4 w-4" />
                <span>Knowledge</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToolSelect} className="gap-2">
                <Plug className="h-4 w-4" />
                <span>Tools</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" className="gap-2">
                {currentAssistant ? (
                  <>
                    <Avatar className="h-4 w-4">
                      <AvatarFallback className="text-[10px]">
                        {currentAssistant.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs">
                      {(() => {
                        const model = getModelById(currentAssistant.model_id)
                        return model ? `${currentAssistant.name} · ${model.name}` : currentAssistant.name
                      })()}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Select model or assistant</span>
                )}
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem] p-2 w-[280px]"
            >
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "models" | "assistants")}>
                <TabsList className="grid w-full grid-cols-2 mb-2">
                  <TabsTrigger value="models" className="text-xs">
                    Models
                  </TabsTrigger>
                  <TabsTrigger value="assistants" className="text-xs">
                    Assistants
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="models" className="mt-0 space-y-1">
                  {models.length > 0 ? (
                    models.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => handleModelSelect(model.id)}
                        className={cn(
                          "gap-2 cursor-pointer",
                          currentAssistant?.model_id === model.id && "bg-accent"
                        )}
                      >
                        <Avatar className="h-4 w-4">
                          <AvatarFallback className="text-[10px]">
                            {model.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="text-xs">{model.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {getProviderById(model.provider_id)?.name || 'Unknown'}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No models available
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="assistants" className="mt-0 space-y-1">
                  {assistants.length > 0 ? (
                    assistants.map((assistant) => (
                      <DropdownMenuItem
                        key={assistant.id}
                        onClick={() => handleAssistantSelect(assistant)}
                        className={cn(
                          "gap-2 cursor-pointer",
                          currentAssistant?.id === assistant.id && "bg-accent"
                        )}
                      >
                        <Avatar className="h-4 w-4">
                          <AvatarFallback className="text-[10px]">
                            {assistant.avatar_text || assistant.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{assistant.name}</span>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No assistants available
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-1.5">
            <CircleProgress percentage={56} size={20} />
            <span className="text-xs text-muted-foreground">56.0%</span>
          </div>
          <Separator orientation="vertical" className="!h-4" />
          <InputGroupButton
            variant="default"
            className="rounded-full"
            size="icon-xs"
            disabled={!input.trim() || !currentTopic || !currentAssistant || isSending}
            onClick={() => {
              console.log('🔘 Send button clicked!')
              console.log('Button state:', {
                hasInput: !!input.trim(),
                hasTopic: !!currentTopic,
                hasAssistant: !!currentAssistant,
                isSending
              })
              handleSend()
            }}
          >
            <ArrowUpIcon />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

