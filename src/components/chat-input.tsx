import { ArrowUpIcon, Paperclip, File, Image, Sparkles, BookOpen, Plug, Globe, X, Square } from "lucide-react"
import React, { useState, useRef, useEffect, useMemo } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { ModelList, type ModelVendor, type Model as ModelListModel } from "@/components/model-list"
import { AssistantList, type AssistantGroup, type Assistant as AssistantListAssistant } from "@/components/assistant-list"
import { getModelLogo } from "@/lib/model-logos"

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
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
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
  const assistants = useAssistantStore((state) => state.assistants)
  
  // Get conversation-specific state
  const conversationState = useMessageStore((state) => 
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )
  const sendMessage = useMessageStore((state) => state.sendMessage)
  const stopGeneration = useMessageStore((state) => state.stopGeneration)
  const isSending = useMessageStore((state) => state.isSending)
  
  // Get streaming state from current conversation
  const isStreaming = conversationState?.isStreaming || false
  const isWaitingForAI = conversationState?.isWaitingForAI || false
  
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
        hasUserPrompt: !!userPrompt,
        modelDbId: selectedAssistant ? undefined : modelToUse.id,
        assistantDbId: selectedAssistant?.id,
        selectedAssistant: selectedAssistant?.name,
        selectedModel: selectedModel?.name,
        modelToUse: modelToUse?.name
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
        selectedAssistant ? undefined : modelToUse.id, // modelDbId - only send if not using assistant
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
    // IME composition keys have keyCode 229
    // This is the most reliable way to detect IME input
    if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
      return // Let IME handle the input
    }
    
    // Command+Enter or Ctrl+Enter: insert new line manually
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = input.substring(0, start) + "\n" + input.substring(end)
      setInput(newValue)
      
      // Set cursor position after the inserted newline
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1
      }, 0)
      return
    }
    
    // Enter without modifiers: send message
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
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
    
    // Close the dropdown menu
    setIsModelMenuOpen(false)
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
    
    // Close the dropdown menu
    setIsModelMenuOpen(false)
  }

  const handleModelStarToggle = async (model: ModelListModel) => {
    console.log("Toggle star for model:", model)
    // Find the real model from store
    const realModel = models.find((m) => m.id === model.id)
    if (realModel) {
      try {
        const { updateModel } = useModelStore.getState()
        await updateModel(realModel.id, {
          name: realModel.name,
          provider_id: realModel.provider_id,
          model_id: realModel.model_id,
          description: realModel.description,
          is_starred: !realModel.is_starred,
        })
      } catch (error) {
        console.error("Failed to toggle star:", error)
      }
    }
  }

  const handleAssistantStarToggle = async (assistant: AssistantListAssistant) => {
    console.log("Toggle star for assistant:", assistant)
    // Find the real assistant from store
    const realAssistant = assistants.find((a) => a.id === assistant.id)
    if (realAssistant) {
      try {
        const { updateAssistant } = useAssistantStore.getState()
        await updateAssistant(realAssistant.id, {
          name: realAssistant.name,
          system_prompt: realAssistant.system_prompt,
          model_id: realAssistant.model_id,
          avatar_bg: realAssistant.avatar_bg,
          avatar_text: realAssistant.avatar_text,
          is_starred: !realAssistant.is_starred,
        })
      } catch (error) {
        console.error("Failed to toggle star:", error)
      }
    }
  }

  // Get display text for current selection
  const getSelectionDisplay = () => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      return model ? `${selectedAssistant.name} - ${model.name}` : selectedAssistant.name
    } else if (selectedModel) {
      const provider = getProviderById(selectedModel.provider_id)
      return provider ? `${selectedModel.name} - ${provider.name}` : selectedModel.name
    } else {
      return "Select model or assistant"
    }
  }

  // Transform models to ModelVendor groups
  const modelVendors = useMemo((): ModelVendor[] => {
    const vendorMap = new Map<string, ModelListModel[]>()
    
    models.forEach((model) => {
      const provider = getProviderById(model.provider_id)
      if (!provider) return
      
      const vendorKey = provider.id
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, [])
      }
      
      vendorMap.get(vendorKey)!.push({
        id: model.id,
        name: model.name,
        modelId: model.model_id,
        providerName: provider.name,
        isStarred: model.is_starred,
      })
    })
    
    return Array.from(vendorMap.entries()).map(([vendorId, models]) => {
      const provider = getProviderById(vendorId)
      return {
        id: vendorId,
        name: provider?.name || 'Unknown',
        models,
      }
    })
  }, [models, getProviderById])

  // Transform assistants to AssistantGroup groups
  const assistantGroups = useMemo((): AssistantGroup[] => {
    const groupMap = new Map<string, AssistantListAssistant[]>()
    
    assistants.forEach((assistant) => {
      const groupName = assistant.group_name || 'Default'
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
      }
      
      const model = getModelById(assistant.model_id)
      
      groupMap.get(groupName)!.push({
        id: assistant.id,
        name: assistant.name,
        persona: assistant.role,
        modelName: model?.name,
        logo: assistant.avatar_image_url,
        avatarBg: assistant.avatar_bg,
        avatarText: assistant.avatar_text,
        isStarred: assistant.is_starred,
      })
    })
    
    return Array.from(groupMap.entries()).map(([groupName, assistants]) => ({
      id: groupName.toLowerCase().replace(/\s+/g, '-'),
      name: groupName,
      assistants,
    }))
  }, [assistants, getModelById])

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
          <DropdownMenu open={isModelMenuOpen} onOpenChange={setIsModelMenuOpen}>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" className="gap-2">
                {(() => {
                  if (selectedAssistant) {
                    // For assistants, show their avatar (custom image or text/emoji with background)
                    const hasCustomImage = selectedAssistant.avatar_type === "image" && 
                                          (selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path)
                    const avatarBg = selectedAssistant.avatar_bg || "#3b82f6"
                    const isHexColor = avatarBg.startsWith("#")
                    const avatarStyle = isHexColor ? { backgroundColor: avatarBg } : undefined
                    const avatarClassName = !isHexColor ? avatarBg : undefined
                    
                    return (
                      <>
                        <Avatar key={`assistant-${selectedAssistant.id}`} className={cn("h-4 w-4", avatarClassName)} style={avatarStyle}>
                          {hasCustomImage && (
                            <AvatarImage src={selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path} alt={selectedAssistant.name} />
                          )}
                          <AvatarFallback className={cn("text-white text-[8px]", avatarClassName)} style={avatarStyle}>
                            {selectedAssistant.avatar_text || selectedAssistant.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{getSelectionDisplay()}</span>
                      </>
                    )
                  } else if (selectedModel) {
                    // For models, show model logo with first character fallback
                    const modelLogo = getModelLogo(selectedModel)
                    
                    return (
                      <>
                        <Avatar key={`model-${selectedModel.id}`} className="h-4 w-4">
                          {modelLogo && <AvatarImage src={modelLogo} alt={selectedModel.name} />}
                          <AvatarFallback className="text-[10px]">
                            {selectedModel.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{getSelectionDisplay()}</span>
                      </>
                    )
                  } else {
                    return <span className="text-xs">{getSelectionDisplay()}</span>
                  }
                })()}
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem] p-2 w-[320px] max-h-[400px] overflow-y-auto"
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
                <TabsContent value="models" className="mt-0">
                  {modelVendors.length > 0 ? (
                    <ModelList
                      vendors={modelVendors}
                      selectedModelId={selectedModel?.id}
                      onModelClick={(model) => handleModelSelect(model.id)}
                      onModelStarToggle={handleModelStarToggle}
                      compact={true}
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No models available
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="assistants" className="mt-0">
                  {assistantGroups.length > 0 ? (
                    <AssistantList
                      groups={assistantGroups}
                      selectedAssistantId={selectedAssistant?.id}
                      onAssistantClick={(assistant) => handleAssistantSelect(assistant.id)}
                      onAssistantStarToggle={handleAssistantStarToggle}
                      compact={true}
                    />
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
