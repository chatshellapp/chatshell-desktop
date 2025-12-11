import {
  ArrowUpIcon,
  Plus,
  FileText,
  Image,
  Globe,
  Square,
  Settings2,
  Search,
  SlidersHorizontal,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Switch } from '@/components/ui/switch'
import { ModelSelectorDropdown } from './ModelSelectorDropdown'
import type { Model } from '@/types'
import type { Assistant } from '@/types/assistant'

interface InputToolbarProps {
  // Add attachment handlers
  onFileSelect: () => void
  onImageSelect: () => void
  onWebPageSelect: () => void
  onUserPromptSelect: () => void
  // Settings
  webSearchEnabled: boolean
  onWebSearchEnabledChange: (enabled: boolean) => void
  // Model selector
  isModelMenuOpen: boolean
  onModelMenuOpenChange: (open: boolean) => void
  activeTab: 'models' | 'assistants'
  onActiveTabChange: (tab: 'models' | 'assistants') => void
  // Send/Stop
  isStreaming: boolean
  isWaitingForAI: boolean
  isSending: boolean
  canSend: boolean
  selectedModel: Model | null
  selectedAssistant: Assistant | null
  onSend: () => void
  onStop: () => void
  // Model parameters
  onModelParametersClick: () => void
  modelParametersLabel: string
  // Context count
  onContextCountClick: () => void
  contextCountLabel: string
  // System Prompt
  onSystemPromptClick: () => void
  systemPromptLabel: string
  systemPromptDisabled?: boolean
}

export function InputToolbar({
  onFileSelect,
  onImageSelect,
  onWebPageSelect,
  onUserPromptSelect,
  webSearchEnabled,
  onWebSearchEnabledChange,
  isModelMenuOpen,
  onModelMenuOpenChange,
  activeTab,
  onActiveTabChange,
  isStreaming,
  isWaitingForAI,
  isSending,
  canSend,
  selectedModel,
  selectedAssistant,
  onSend,
  onStop,
  onModelParametersClick,
  modelParametersLabel,
  onContextCountClick,
  contextCountLabel,
  onSystemPromptClick,
  systemPromptLabel,
  systemPromptDisabled = false,
}: InputToolbarProps) {
  return (
    <InputGroupAddon align="block-end">
      {/* Add attachment dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <InputGroupButton variant="outline" className="rounded-full" size="icon-xs">
            <Plus />
          </InputGroupButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem]">
          <DropdownMenuItem onClick={onUserPromptSelect} className="gap-2">
            <Sparkles className="size-4" />
            <span>User Prompt</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onWebPageSelect} className="gap-2">
            <Globe className="size-4" />
            <span>Web Page</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFileSelect} className="gap-2">
            <FileText className="size-4" />
            <span>Document</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImageSelect} className="gap-2">
            <Image className="size-4" />
            <span>Image</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <InputGroupButton variant="outline" className="rounded-full" size="icon-xs">
            <Settings2 />
          </InputGroupButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem] min-w-[200px]">
          <DropdownMenuItem className="gap-2 justify-between" onSelect={(e) => e.preventDefault()}>
            <div className="flex items-center gap-2">
              <Search className="size-4" />
              <span>Web Search</span>
            </div>
            <Switch checked={webSearchEnabled} onCheckedChange={onWebSearchEnabledChange} />
          </DropdownMenuItem>
          {/* <DropdownMenuItem className="gap-2 justify-between" onSelect={(e) => e.preventDefault()}>
            <div className="flex items-center gap-2">
              <Package className="size-4" />
              <span>Artifacts</span>
            </div>
            <Switch checked={artifactsEnabled} onCheckedChange={onArtifactsEnabledChange} />
          </DropdownMenuItem> */}
          <DropdownMenuSeparator />
          {systemPromptDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-not-allowed">
                  <DropdownMenuItem
                    className="gap-2 justify-between pointer-events-none opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4" />
                      <span>System Prompt</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{systemPromptLabel}</span>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">
                System prompt can only be changed when conversation is empty
              </TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem
              onClick={onSystemPromptClick}
              className="gap-2 justify-between"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="size-4" />
                <span>System Prompt</span>
              </div>
              <span className="text-xs text-muted-foreground">{systemPromptLabel}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onModelParametersClick} className="gap-2 justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" />
              <span>Parameters</span>
            </div>
            <span className="text-xs text-muted-foreground">{modelParametersLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onContextCountClick} className="gap-2 justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              <span>Context</span>
            </div>
            <span className="text-xs text-muted-foreground">{contextCountLabel}</span>
          </DropdownMenuItem>
          {/* <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onKnowledgeBaseSelect} className="gap-2">
            <BookOpen className="size-4" />
            <span>Knowledge</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToolSelect} className="gap-2">
            <Plug className="size-4" />
            <span>Tools</span>
          </DropdownMenuItem> */}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Model selector */}
      <ModelSelectorDropdown
        isOpen={isModelMenuOpen}
        onOpenChange={onModelMenuOpenChange}
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
      />

      <div className="ml-auto flex items-center gap-1.5">
        {/* Placeholder for future progress indicator */}
      </div>

      {/* <Separator orientation="vertical" className="!h-4" /> */}

      {/* Send/Stop button */}
      {isStreaming || isWaitingForAI ? (
        <InputGroupButton
          variant="default"
          className="rounded-full"
          size="icon-xs"
          onClick={onStop}
        >
          <Square className="size-3 fill-current" />
          <span className="sr-only">Stop</span>
        </InputGroupButton>
      ) : (
        <InputGroupButton
          variant="default"
          className="rounded-full"
          size="icon-xs"
          disabled={!canSend || (!selectedModel && !selectedAssistant) || isSending}
          onClick={onSend}
        >
          <ArrowUpIcon />
          <span className="sr-only">Send</span>
        </InputGroupButton>
      )}
    </InputGroupAddon>
  )
}
