import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy, Languages, Undo, Scan, Check } from 'lucide-react'
import { useState, memo, useCallback } from 'react'
import { MorphSpinner } from '@/components/ui/morph-spinner'
import { ModelAvatar } from '@/components/model-avatar'
import { AssistantAvatar } from '@/components/assistant-avatar'
import { MarkdownContent } from '@/components/markdown-content'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
  /**
   * Display name for the AI sender (model name or "assistant name · model name")
   */
  displayName?: string
  /**
   * Type of sender: "model" or "assistant" - used to render the correct avatar
   */
  senderType?: 'model' | 'assistant'
  /**
   * For model senders: direct logo URL from getModelLogo()
   */
  modelLogo?: string
  /**
   * For assistant senders: custom image URL
   */
  assistantLogo?: string
  /**
   * For assistant senders with text avatars: background color
   */
  avatarBg?: string
  /**
   * For assistant senders with text avatars: text/emoji to display
   */
  avatarText?: string
  userMessageAlign?: 'left' | 'right'
  userMessageShowBackground?: boolean
  isLoading?: boolean
  /**
   * Content to render after the header (avatar/name) but before the message content.
   * Used for assistant attachments like search_decision and search_result.
   */
  headerContent?: React.ReactNode
  onCopy?: () => void
  onResend?: () => void
  onTranslate?: () => void
  onExportAll?: () => void
  onExportConversation?: () => void
  onExportMessage?: () => void
}

export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  timestamp,
  displayName = 'AI Assistant',
  senderType = 'model',
  modelLogo,
  assistantLogo,
  avatarBg,
  avatarText,
  userMessageAlign = 'right',
  userMessageShowBackground = true,
  isLoading = false,
  headerContent,
  onCopy,
  onResend,
  onTranslate,
  onExportAll,
  onExportConversation,
  onExportMessage,
}: ChatMessageProps) {
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  // Render the appropriate avatar based on sender type
  const renderAvatar = () => {
    if (senderType === 'assistant') {
      // For assistants: use AssistantAvatar with custom styling
      return (
        <AssistantAvatar
          logo={assistantLogo}
          avatarBg={avatarBg}
          avatarText={avatarText}
          name={displayName}
          size="xs"
        />
      )
    }
    // For models: use ModelAvatar
    // Extract model name from displayName (remove provider part like "Qwen3 - Ollama" -> "Qwen3")
    const modelName = displayName.split(' - ')[0] || displayName
    return <ModelAvatar logo={modelLogo} name={modelName} size="xs" />
  }

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
    onCopy?.()
  }, [content, onCopy])

  if (role === 'user') {
    const alignClass = userMessageAlign === 'right' ? 'justify-end' : 'justify-start'
    const backgroundClass = userMessageShowBackground ? 'bg-muted/50' : ''

    return (
      <div className={`group relative isolate flex flex-col px-4 my-1`}>
        {timestamp && (
          <div className={`flex ${alignClass} mb-1`}>
            <span className="text-xs text-muted-foreground transition-opacity opacity-0 group-hover:opacity-100">
              {timestamp}
            </span>
          </div>
        )}
        <div className={`flex ${alignClass}`}>
          <div className={`px-4 py-3 ${backgroundClass} rounded-lg max-w-[80%]`}>
            <p className="text-base text-foreground whitespace-pre-wrap">{content}</p>
          </div>
        </div>
        <TooltipProvider delayDuration={300}>
          <div
            className={`flex gap-1 justify-end transition-opacity ${isExportOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopy}>
                  {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isCopied ? 'Copied!' : 'Copy'}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onResend}>
                  <Undo className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Revert</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenu open={isExportOpen} onOpenChange={setIsExportOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <Scan className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Screenshot</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={onExportAll}>Export All Messages</DropdownMenuItem>
                <DropdownMenuItem onClick={onExportConversation}>
                  Export Current Conversation
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExportMessage}>
                  Export Current Message
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
      </div>
    )
  }

  return (
    <div className="group relative isolate px-4 py-2 mx-4 my-1">
      <div className="flex items-center gap-2 mb-2">
        {renderAvatar()}
        <span className="text-xs text-muted-foreground">{displayName}</span>
        {timestamp && (
          <span className="text-xs text-muted-foreground transition-opacity opacity-0 group-hover:opacity-100">
            {timestamp}
          </span>
        )}
      </div>
      {/* Assistant attachments (search_decision, search_result) rendered after header, before content */}
      {headerContent}
      <div className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none mb-2">
        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <MorphSpinner size={16} />
          </div>
        ) : (
          <MarkdownContent content={content} />
        )}
      </div>
      <TooltipProvider delayDuration={300}>
        <div
          className={`flex gap-1 transition-opacity ${isExportOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopy}>
                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isCopied ? 'Copied!' : 'Copy'}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onTranslate}>
                <Languages className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Translate</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenu open={isExportOpen} onOpenChange={setIsExportOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <Scan className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Screenshot</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onExportAll}>Export All Messages</DropdownMenuItem>
              <DropdownMenuItem onClick={onExportConversation}>
                Export Current Conversation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportMessage}>Export Current Message</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>
    </div>
  )
})
