import { ArrowUpIcon, Paperclip, File, Image, Sparkles, BookOpen, Plug, Globe, X } from "lucide-react"
import { useState, useMemo } from "react"
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
import type { Model, ModelVendor } from "@/components/model-list"
import type { Assistant, AssistantGroup } from "@/components/assistant-list"

interface ModelOption extends Model {
  type: "model"
  vendorName?: string
}

interface AssistantOption extends Assistant {
  type: "assistant"
}

type SelectionOption = ModelOption | AssistantOption

type AttachmentType = "webpage" | "file" | "image" | "knowledge" | "tools"

interface Attachment {
  id: string
  type: AttachmentType
  name: string
}

interface ChatInputProps {
  modelVendors?: ModelVendor[]
  assistantGroups?: AssistantGroup[]
}

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

export function ChatInput({ modelVendors = [], assistantGroups = [] }: ChatInputProps) {
  // State for attachments
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [hoveredBadgeId, setHoveredBadgeId] = useState<string | null>(null)

  // URL regex pattern to detect URLs (handles URLs within sentences)
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)/g

  // Collect all starred models from all vendors
  const starredModels = useMemo(() => {
    const models: ModelOption[] = []
    modelVendors.forEach((vendor) => {
      vendor.models.forEach((model) => {
        if (model.isStarred) {
          models.push({ ...model, type: "model", vendorName: vendor.name })
        }
      })
    })
    return models
  }, [modelVendors])

  // Collect all starred assistants from all groups
  const starredAssistants = useMemo(() => {
    const assistants: AssistantOption[] = []
    assistantGroups.forEach((group) => {
      group.assistants.forEach((assistant) => {
        if (assistant.isStarred) {
          assistants.push({ ...assistant, type: "assistant" })
        }
      })
    })
    return assistants
  }, [assistantGroups])

  // Initialize with first starred model or first starred assistant, or null
  const [selectedOption, setSelectedOption] = useState<SelectionOption | null>(() => {
    const models: ModelOption[] = []
    modelVendors.forEach((vendor) => {
      vendor.models.forEach((model) => {
        if (model.isStarred) {
          models.push({ ...model, type: "model", vendorName: vendor.name })
        }
      })
    })
    
    const assistants: AssistantOption[] = []
    assistantGroups.forEach((group) => {
      group.assistants.forEach((assistant) => {
        if (assistant.isStarred) {
          assistants.push({ ...assistant, type: "assistant" })
        }
      })
    })
    
    return models[0] || assistants[0] || null
  })
  
  const [activeTab, setActiveTab] = useState<"models" | "assistants">(
    starredModels.length > 0 ? "models" : "assistants"
  )

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

  const handleMCPServerSelect = () => {
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

  const renderAvatar = (option: SelectionOption) => {
    if (option.type === "model") {
      return (
        <Avatar className="h-4 w-4">
          <AvatarImage src={option.logo} />
          <AvatarFallback className="text-[10px]">
            {option.name.charAt(0)}
          </AvatarFallback>
        </Avatar>
      )
    } else {
      // Determine if avatarBg is a hex color or a Tailwind class
      const isHexColor = option.avatarBg?.startsWith("#")
      const avatarStyle = isHexColor && option.avatarBg ? { backgroundColor: option.avatarBg } : undefined
      const avatarClassName = !isHexColor && option.avatarBg ? option.avatarBg : undefined

      return (
        <Avatar className={cn("h-4 w-4", avatarClassName)} style={avatarStyle}>
          {option.logo ? (
            <AvatarImage src={option.logo} alt={option.name} />
          ) : (
            <AvatarFallback 
              className={cn("text-xs text-white border-0", avatarClassName)} 
              style={avatarStyle}
            >
              {option.avatarText || <Sparkles className="h-2.5 w-2.5" />}
            </AvatarFallback>
          )}
        </Avatar>
      )
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
          placeholder="Ask, Search or Chat..." 
          onPaste={handlePaste}
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
              <DropdownMenuItem onClick={handleMCPServerSelect} className="gap-2">
                <Plug className="h-4 w-4" />
                <span>Tools</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" className="gap-2">
                {selectedOption ? (
                  <>
                    {renderAvatar(selectedOption)}
                    <span className="text-xs">
                      {selectedOption.type === "model" && selectedOption.vendorName
                        ? `${selectedOption.name} · ${selectedOption.vendorName}`
                        : selectedOption.name}
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
                  {starredModels.length > 0 ? (
                    starredModels.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => setSelectedOption(model)}
                        className="gap-2 cursor-pointer"
                      >
                        <Avatar className="h-4 w-4">
                          <AvatarImage src={model.logo} />
                          <AvatarFallback className="text-[10px]">
                            {model.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">
                          {model.vendorName ? `${model.name} · ${model.vendorName}` : model.name}
                        </span>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No starred models
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="assistants" className="mt-0 space-y-1">
                  {starredAssistants.length > 0 ? (
                    starredAssistants.map((assistant) => {
                      const isHexColor = assistant.avatarBg?.startsWith("#")
                      const avatarStyle = isHexColor && assistant.avatarBg ? { backgroundColor: assistant.avatarBg } : undefined
                      const avatarClassName = !isHexColor && assistant.avatarBg ? assistant.avatarBg : undefined
                      
                      return (
                        <DropdownMenuItem
                          key={assistant.id}
                          onClick={() => setSelectedOption(assistant)}
                          className="gap-2 cursor-pointer"
                        >
                          <Avatar className={cn("h-4 w-4", avatarClassName)} style={avatarStyle}>
                            {assistant.logo ? (
                              <AvatarImage src={assistant.logo} alt={assistant.name} />
                            ) : (
                              <AvatarFallback 
                                className={cn("text-xs text-white border-0", avatarClassName)} 
                                style={avatarStyle}
                              >
                                {assistant.avatarText || <Sparkles className="h-2.5 w-2.5" />}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <span className="text-xs">{assistant.name}</span>
                        </DropdownMenuItem>
                      )
                    })
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No starred assistants
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
            disabled
          >
            <ArrowUpIcon />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

