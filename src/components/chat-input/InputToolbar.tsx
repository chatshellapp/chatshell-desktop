import { useTranslation } from 'react-i18next'
import {
  ArrowUpIcon,
  Plus,
  FileText,
  Image,
  Globe,
  Square,
  Settings2,
  SlidersHorizontal,
  MessageSquare,
  Sparkles,
  Wrench,
  Zap,
  FolderOpen,
  Shield,
  ShieldCheck,
  ShieldOff,
  Check,
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
import { ModelSelectorDropdown } from './ModelSelectorDropdown'
import type { Model } from '@/types'
import type { Assistant } from '@/types/assistant'
import type { PermissionMode } from '@/types'
import {
  autoUnavailableMessageKey,
  permissionModeHintKey,
  useSandboxAvailable,
} from '@/lib/permission-mode'

interface InputToolbarProps {
  // Add attachment handlers
  onFileSelect: () => void
  onImageSelect: () => void
  onFolderSelect: () => void
  onWebPageSelect: () => void
  onUserPromptSelect: () => void
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
  // MCP Servers
  onMcpServersClick: () => void
  mcpServersLabel: string
  // Skills
  onSkillsClick: () => void
  skillsLabel: string
  // Working Directory
  onWorkingDirectorySelect: () => void
  // Permission mode (ask / auto / yolo)
  permissionMode: PermissionMode
  onPermissionModeSelect: (mode: PermissionMode) => void
  /** Offer `auto` (the selected model has an eligible auto reviewer). */
  autoAvailable: boolean
  /** Why the auto reviewer is unavailable, shown when `auto` is hidden. */
  autoUnavailableReason?: string | null
  autoUnavailableCause?: string | null
  // Model capability flags
  toolsDisabled?: boolean
  skillsDisabled?: boolean
  imageAttachDisabled?: boolean
}

/** Modes in escalation order; only crossing into `yolo` asks to confirm. */
const PERMISSION_MODES: PermissionMode[] = ['ask', 'auto', 'yolo']

function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  switch (mode) {
    case 'ask':
      return <Shield className={className} />
    case 'auto':
      return <ShieldCheck className={className} />
    case 'yolo':
      return <ShieldOff className={className} />
  }
}

export function InputToolbar({
  onFileSelect,
  onImageSelect,
  onFolderSelect,
  onWebPageSelect,
  onUserPromptSelect,
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
  onMcpServersClick,
  mcpServersLabel,
  onSkillsClick,
  skillsLabel,
  onWorkingDirectorySelect,
  permissionMode,
  onPermissionModeSelect,
  autoAvailable,
  autoUnavailableReason = null,
  autoUnavailableCause = null,
  toolsDisabled = false,
  skillsDisabled = false,
  imageAttachDisabled = false,
}: InputToolbarProps) {
  const { t } = useTranslation('chat')
  const sandboxAvailable = useSandboxAvailable()
  return (
    <InputGroupAddon align="block-end">
      {/* Add attachment dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <InputGroupButton
                variant="outline"
                className="rounded-full"
                size="icon-xs"
                aria-label={t('addToMessage')}
              >
                <Plus />
              </InputGroupButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{t('addToMessage')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem]">
          <DropdownMenuItem onClick={onUserPromptSelect} className="gap-2">
            <Sparkles className="size-4" />
            <span>{t('userPrompt')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onWebPageSelect} className="gap-2">
            <Globe className="size-4" />
            <span>{t('attachWebPage')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFileSelect} className="gap-2">
            <FileText className="size-4" />
            <span>{t('attachFile')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFolderSelect} className="gap-2">
            <FolderOpen className="size-4" />
            <span>{t('attachFolder')}</span>
          </DropdownMenuItem>
          {imageAttachDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-not-allowed">
                  <DropdownMenuItem className="gap-2 pointer-events-none opacity-50">
                    <Image className="size-4" />
                    <span>{t('attachImage')}</span>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{t('imageUnsupportedByModel')}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem onClick={onImageSelect} className="gap-2">
              <Image className="size-4" />
              <span>{t('attachImage')}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <InputGroupButton
                variant="outline"
                className="rounded-full"
                size="icon-xs"
                aria-label={t('conversationOptions')}
              >
                <Settings2 />
              </InputGroupButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{t('conversationOptions')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem] min-w-[200px]">
          {/* <DropdownMenuItem className="gap-2 justify-between" onSelect={(e) => e.preventDefault()}>
            <div className="flex items-center gap-2">
              <Search className="size-4" />
              <span>{t('preWebSearch')}</span>
            </div>
            <Switch checked={webSearchEnabled} onCheckedChange={onWebSearchEnabledChange} />
          </DropdownMenuItem> */}
          {/* <DropdownMenuItem className="gap-2 justify-between" onSelect={(e) => e.preventDefault()}>
            <div className="flex items-center gap-2">
              <Package className="size-4" />
              <span>{t('artifacts')}</span>
            </div>
            <Switch checked={artifactsEnabled} onCheckedChange={onArtifactsEnabledChange} />
          </DropdownMenuItem> */}
          {/* <DropdownMenuSeparator /> */}
          {systemPromptDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-not-allowed">
                  <DropdownMenuItem className="gap-2 justify-between pointer-events-none opacity-50">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4" />
                      <span>{t('systemPrompt')}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{systemPromptLabel}</span>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">{t('systemPromptDisabledTooltip')}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem onClick={onSystemPromptClick} className="gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4" />
                <span>{t('systemPrompt')}</span>
              </div>
              <span className="text-xs text-muted-foreground">{systemPromptLabel}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onModelParametersClick} className="gap-2 justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" />
              <span>{t('parameters')}</span>
            </div>
            <span className="text-xs text-muted-foreground">{modelParametersLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onContextCountClick} className="gap-2 justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              <span>{t('context')}</span>
            </div>
            <span className="text-xs text-muted-foreground">{contextCountLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {toolsDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-not-allowed">
                  <DropdownMenuItem className="gap-2 justify-between pointer-events-none opacity-50">
                    <div className="flex items-center gap-2">
                      <Wrench className="size-4" />
                      <span>{t('toolsAndMcp')}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{mcpServersLabel}</span>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">{t('toolsUnsupportedByModel')}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem onClick={onMcpServersClick} className="gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="size-4" />
                <span>{t('toolsAndMcp')}</span>
              </div>
              <span className="text-xs text-muted-foreground">{mcpServersLabel}</span>
            </DropdownMenuItem>
          )}
          {skillsDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-not-allowed">
                  <DropdownMenuItem className="gap-2 justify-between pointer-events-none opacity-50">
                    <div className="flex items-center gap-2">
                      <Zap className="size-4" />
                      <span>{t('skills')}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{skillsLabel}</span>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">{t('toolsUnsupportedByModel')}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem onClick={onSkillsClick} className="gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Zap className="size-4" />
                <span>{t('skills')}</span>
              </div>
              <span className="text-xs text-muted-foreground">{skillsLabel}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onWorkingDirectorySelect} className="gap-2">
            <FolderOpen className="size-4" />
            <span>{t('workingDirectory')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Permission mode chip: always visible so the current mode is
          inspectable before every send */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <InputGroupButton
            variant="ghost"
            className="rounded-full h-7 px-2.5 gap-1.5"
            title={t('permission.title')}
          >
            <PermissionModeIcon mode={permissionMode} className="size-3.5" />
            <span className="text-xs">{t(`permission.mode.${permissionMode}`)}</span>
          </InputGroupButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-[240px]">
          {PERMISSION_MODES.filter((mode) => mode !== 'auto' || autoAvailable).map((mode) => (
            <DropdownMenuItem
              key={mode}
              className="gap-2 justify-between"
              onClick={() => onPermissionModeSelect(mode)}
            >
              <div className="flex items-center gap-2">
                <PermissionModeIcon mode={mode} className="size-4" />
                <div className="flex flex-col">
                  <span>{t(`permission.mode.${mode}`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(permissionModeHintKey(mode, sandboxAvailable))}
                  </span>
                </div>
              </div>
              {permissionMode === mode && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          {!autoAvailable && (
            <div
              className="px-2 py-1.5 text-xs text-muted-foreground max-w-[280px]"
              title={autoUnavailableReason ?? undefined}
            >
              {t(autoUnavailableMessageKey(autoUnavailableCause))}
            </div>
          )}
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
          <span className="sr-only">{t('stop')}</span>
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
          <span className="sr-only">{t('send')}</span>
        </InputGroupButton>
      )}
    </InputGroupAddon>
  )
}
