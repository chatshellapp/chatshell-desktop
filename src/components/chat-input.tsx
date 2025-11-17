import { ArrowUpIcon, Paperclip, File, Image, Sparkles, BookOpen, Plug, Globe, X, Square } from "lucide-react"
import React, { useState, useRef, useEffect } from "react"
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
import { useConversationStore } from "@/stores/conversationStore"
import { useMessageStore } from "@/stores/messageStore"
import { useModelStore } from "@/stores/modelStore"
import { useSettingsStore } from "@/stores/settingsStore"
import { useAssistantStore } from "@/stores/assistantStore"
import type { Model } from "@/types"

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
  const { 
    currentConversation,
    selectedModel,
    selectedAssistant,
    setSelectedModel,
    setSelectedAssistant,
  } = useConversationStore()
  
  const { models, getModelById, getProviderById } = useModelStore()
  const { assistants } = useAssistantStore()
  const { sendMessage, stopGeneration, isSending, isStreaming, isWaitingForAI } = useMessageStore()
  const { getSetting } = useSettingsStore()

  // Auto-focus textarea when conversation changes
  useEffect(() => {
    if (currentConversation && textareaRef.current) {
      // Use a small delay to ensure the component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [currentConversation])

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
    addAttachment("file", "example-document.pdf")
  }

  const handleImageSelect = () => {
    addAttachment("image", "example-image.png")
  }

  const handleKnowledgeBaseSelect = () => {
    addAttachment("knowledge", "Documentation")
  }

  const handleToolSelect = () => {
    addAttachment("tools", "Calculator")
  }

  const handleWebPageSelect = () => {
    addAttachment("webpage", "https://example.com")
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData("text")
    const urls = pastedText.match(urlRegex)
    
    if (urls && urls.length > 0) {
      urls.forEach((url) => {
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
      hasCurrentConversation: !!currentConversation,
      selectedModel: selectedModel?.name,
      selectedAssistant: selectedAssistant?.name,
    })

    if (!input.trim()) {
      console.warn("Cannot send: empty input")
      return
    }

    // Check if we have either a model or assistant selected
    if (!selectedModel && !selectedAssistant) {
      alert("Please select a model or assistant first")
      return
    }

    // Determine which model to use
    let modelToUse: Model | undefined
    let providerType: string
    let modelIdStr: string

    if (selectedAssistant) {
      // Use assistant's model
      modelToUse = getModelById(selectedAssistant.model_id)
      if (!modelToUse) {
        console.error("Model not found for assistant:", selectedAssistant.model_id)
        alert("Error: Model configuration not found for assistant")
        return
      }
    } else if (selectedModel) {
      // Use selected model directly
      modelToUse = selectedModel
    } else {
      alert("Please select a model or assistant first")
      return
    }

    // Get provider info
    const provider = getProviderById(modelToUse.provider_id)
    if (!provider) {
      console.error("Provider not found for model:", modelToUse.provider_id)
      alert("Error: Provider configuration not found")
      return
    }

    providerType = provider.provider_type
    modelIdStr = modelToUse.model_id

    const content = input.trim()
    setInput("")

    try {
      // Get API credentials
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

      // Get prompts from assistant if selected
      let systemPrompt: string | undefined
      let userPrompt: string | undefined
      
      if (selectedAssistant) {
        systemPrompt = selectedAssistant.system_prompt
        userPrompt = selectedAssistant.user_prompt || undefined
        console.log("Using assistant prompts:", {
          hasSystemPrompt: !!systemPrompt,
          hasUserPrompt: !!userPrompt
        })
      }

      console.log("Sending message:", {
        content,
        conversationId: currentConversation?.id,
        provider: providerType,
        model: modelIdStr,
        hasApiKey: !!apiKey,
        baseUrl,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt
      })

      await sendMessage(
        content,
        currentConversation?.id ?? null,
        providerType,
        modelIdStr,
        apiKey,
        baseUrl,
        undefined, // includeHistory
        systemPrompt,
        userPrompt,
        modelToUse.id, // modelDbId
        selectedAssistant?.id // assistantDbId
      )

      console.log("Message sent successfully")
    } catch (error) {
      console.error("Failed to send message:", error)
      alert(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStop = async () => {
    if (!currentConversation) {
      console.warn("Cannot stop: no current conversation")
      return
    }

    console.log("handleStop called for conversation:", currentConversation.id)
    
    try {
      await stopGeneration(currentConversation.id)
      console.log("Generation stopped successfully")
    } catch (error) {
      console.error("Failed to stop generation:", error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleModelSelect = (modelId: string) => {
    console.log('handleModelSelect called with modelId:', modelId)
    const model = getModelById(modelId)
    if (!model) {
      console.error('Model not found:', modelId)
      return
    }
    
    // Simply set the selected model
    setSelectedModel(model)
    console.log('Selected model:', model.name)
  }

  const handleAssistantSelect = (assistantId: string) => {
    console.log('handleAssistantSelect called with assistantId:', assistantId)
    const assistant = assistants.find(a => a.id === assistantId)
    if (!assistant) {
      console.error('Assistant not found:', assistantId)
      return
    }
    
    // Set the selected assistant (this will clear model selection automatically)
    setSelectedAssistant(assistant)
    console.log('Selected assistant:', assistant.name)
  }

  // Get display text for current selection
  const getSelectionDisplay = () => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      return model ? `${selectedAssistant.name} · ${model.name}` : selectedAssistant.name
    } else if (selectedModel) {
      return selectedModel.name
    } else {
      return "Select model or assistant"
    }
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
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={!selectedModel && !selectedAssistant}
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
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[10px]">
                    {selectedAssistant ? selectedAssistant.name.charAt(0) : selectedModel ? selectedModel.name.charAt(0) : '?'}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs">{getSelectionDisplay()}</span>
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
                          selectedModel?.id === model.id && "bg-accent"
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
                    assistants.map((assistant) => {
                      const assistantModel = getModelById(assistant.model_id)
                      return (
                        <DropdownMenuItem
                          key={assistant.id}
                          onClick={() => handleAssistantSelect(assistant.id)}
                          className={cn(
                            "gap-2 cursor-pointer",
                            selectedAssistant?.id === assistant.id && "bg-accent"
                          )}
                        >
                          <Avatar className="h-4 w-4">
                            <AvatarFallback className="text-[10px]">
                              {assistant.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="text-xs">{assistant.name}</span>
                            {assistantModel && (
                              <span className="text-xs text-muted-foreground">
                                {assistantModel.name}
                              </span>
                            )}
                          </div>
                        </DropdownMenuItem>
                      )
                    })
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
          {isStreaming || isWaitingForAI ? (
            <InputGroupButton
              variant="default"
              className="rounded-full"
              size="icon-xs"
              onClick={handleStop}
            >
              <Square className="h-4 w-4" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              className="rounded-full"
              size="icon-xs"
              disabled={!input.trim() || (!selectedModel && !selectedAssistant) || isSending}
              onClick={handleSend}
            >
              <ArrowUpIcon />
              <span className="sr-only">Send</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
