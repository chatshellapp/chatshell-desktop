import { ArrowUpIcon, Paperclip, File, Image, MessageSquare, Database, Server } from "lucide-react"
import { useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import gptAvatar from "@/assets/models/gpt.png"
import claudeAvatar from "@/assets/models/claude.png"
import geminiAvatar from "@/assets/models/gemini.png"
import llamaAvatar from "@/assets/models/llama.png"

interface ModelOption {
  id: string
  name: string
  avatar: string
}

const modelOptions: ModelOption[] = [
  { id: "gpt", name: "GPT-4.1 · OpenRouter", avatar: gptAvatar },
  { id: "claude", name: "Claude 3.5 Sonnet", avatar: claudeAvatar },
  { id: "gemini", name: "Gemini 2.5 Pro", avatar: geminiAvatar },
  { id: "llama", name: "Llama 3.3 70B", avatar: llamaAvatar },
]

export function InputGroupDemo() {
  const [selectedModel, setSelectedModel] = useState<ModelOption>(modelOptions[0])

  const handlePromptSelect = () => {
    console.log("Prompt selected")
  }

  const handleFileSelect = () => {
    console.log("File selected")
  }

  const handleImageSelect = () => {
    console.log("Image selected")
  }

  const handleKnowledgeBaseSelect = () => {
    console.log("Knowledge Base selected")
  }

  const handleMCPServerSelect = () => {
    console.log("MCP Server selected")
  }

  return (
    <div className="grid w-full gap-6">
      <InputGroup>
        <InputGroupTextarea placeholder="Ask, Search or Chat..." />
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
              <DropdownMenuItem onClick={handlePromptSelect} className="gap-2">
                <MessageSquare className="h-4 w-4" />
                <span>Prompt</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFileSelect} className="gap-2">
                <File className="h-4 w-4" />
                <span>File</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImageSelect} className="gap-2">
                <Image className="h-4 w-4" />
                <span>Image</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleKnowledgeBaseSelect} className="gap-2">
                <Database className="h-4 w-4" />
                <span>Knowledge Base</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleMCPServerSelect} className="gap-2">
                <Server className="h-4 w-4" />
                <span>MCP Server</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" className="gap-2">
                <Avatar className="h-4 w-4">
                  <AvatarImage src={selectedModel.avatar} />
                  <AvatarFallback className="text-[10px]">
                    {selectedModel.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs">{selectedModel.name}</span>
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem]"
            >
              {modelOptions.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => setSelectedModel(model)}
                  className="gap-2"
                >
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={model.avatar} />
                    <AvatarFallback className="text-[10px]">
                      {model.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs">{model.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <InputGroupText className="ml-auto">52% used</InputGroupText>
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
