import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Copy, Languages, Undo, Scan } from "lucide-react"
import { useState, memo, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { Spinner } from "@/components/ui/spinner"
import { ModelAvatar } from "@/components/model-avatar"
import { AssistantAvatar } from "@/components/assistant-avatar"

interface ChatMessageProps {
  role: "user" | "assistant"
  content: string
  timestamp?: string
  /**
   * Display name for the AI sender (model name or "assistant name · model name")
   */
  displayName?: string
  /**
   * Type of sender: "model" or "assistant" - used to render the correct avatar
   */
  senderType?: "model" | "assistant"
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
  userMessageAlign?: "left" | "right"
  userMessageShowBackground?: boolean
  isLoading?: boolean
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
  displayName = "AI Assistant",
  senderType = "model",
  modelLogo,
  assistantLogo,
  avatarBg,
  avatarText,
  userMessageAlign = "right",
  userMessageShowBackground = true,
  isLoading = false,
  onCopy,
  onResend,
  onTranslate,
  onExportAll,
  onExportConversation,
  onExportMessage,
}: ChatMessageProps) {
  const [isExportOpen, setIsExportOpen] = useState(false)
  
  // Render the appropriate avatar based on sender type
  const renderAvatar = () => {
    if (senderType === "assistant") {
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
    return (
      <ModelAvatar
        logo={modelLogo}
        name={modelName}
        size="xs"
      />
    )
  }
  
  // Memoize markdown components to avoid recreating them on every render
  const markdownComponents = useMemo(() => ({
    // CODE: Fix for react-markdown v10 (no inline prop)
    code(props: any) {
      const { className, children, ...rest } = props
      const languageMatch = /language-([\w-+]+)/.exec(className || '')
      const content = String(children).replace(/\n$/, '')
      const isMultiline = content.includes('\n')
      const isCodeBlock = languageMatch || isMultiline

      if (isCodeBlock) {
        return (
          <code
            className={`${className || ''} block p-3 rounded-md bg-muted overflow-x-auto text-sm`}
            {...rest}
          >
            {children}
          </code>
        )
      }

      // Inline code
      return (
        <code
          className="px-1.5 py-0.5 rounded-md bg-muted text-sm font-mono"
          {...rest}
        >
          {children}
        </code>
      )
    },

    // PRE: Allow visible overflow for code blocks
    pre({ children }: any) {
      return <pre className="my-2 overflow-visible">{children}</pre>
    },

    p({ children }: any) {
      return <p className="mb-2 last:mb-0">{children}</p>
    },

    // LISTS: Fix nested list indentation (remove list-inside, add pl-5)
    ul({ children }: any) {
      return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
    },
    ol({ children }: any) {
      return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
    },
    li({ children }: any) {
      return <li className="pl-1">{children}</li>
    },

    blockquote({ children }: any) {
      return (
        <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2">
          {children}
        </blockquote>
      )
    },

    // HEADINGS
    h1({ children }: any) {
      return <h1 className="text-2xl font-bold mb-2 mt-4">{children}</h1>
    },
    h2({ children }: any) {
      return <h2 className="text-xl font-bold mb-2 mt-3">{children}</h2>
    },
    h3({ children }: any) {
      return <h3 className="text-lg font-bold mb-2 mt-2">{children}</h3>
    },
    h4({ children }: any) {
      return <h4 className="text-base font-bold mb-2 mt-2">{children}</h4>
    },
    h5({ children }: any) {
      return <h5 className="text-sm font-bold mb-1 mt-2">{children}</h5>
    },
    h6({ children }: any) {
      return <h6 className="text-sm font-semibold mb-1 mt-2">{children}</h6>
    },

    // LINKS: Important for clickable links
    a({ href, children }: any) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {children}
        </a>
      )
    },

    // IMAGES: Prevent overflow
    img({ src, alt }: any) {
      return (
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full h-auto rounded-md my-2"
          loading="lazy"
        />
      )
    },

    // TABLES: Add responsive wrapper
    table({ children }: any) {
      return (
        <div className="overflow-x-auto my-2">
          <table className="w-full border-collapse border border-border">
            {children}
          </table>
        </div>
      )
    },
    thead({ children }: any) {
      return <thead className="bg-muted">{children}</thead>
    },
    tbody({ children }: any) {
      return <tbody>{children}</tbody>
    },
    tr({ children }: any) {
      return <tr className="border-b border-border">{children}</tr>
    },
    th({ children }: any) {
      return (
        <th className="border border-border px-3 py-2 text-left font-semibold">
          {children}
        </th>
      )
    },
    td({ children }: any) {
      return <td className="border border-border px-3 py-2">{children}</td>
    },

    // HORIZONTAL RULE
    hr() {
      return <hr className="my-4 border-t border-border" />
    },

    // TASK LIST CHECKBOX (GFM feature)
    input({ type, checked, disabled }: any) {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            className="mr-2 h-4 w-4 rounded border-border"
            readOnly
          />
        )
      }
      return <input type={type} />
    },

    // STRIKETHROUGH (GFM feature)
    del({ children }: any) {
      return <del className="text-muted-foreground line-through">{children}</del>
    },
  }), [])

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    onCopy?.()
  }

  if (role === "user") {
    const alignClass = userMessageAlign === "right" ? "justify-end" : "justify-start"
    const backgroundClass = userMessageShowBackground ? "bg-muted/50" : ""
    
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
          <div className={`flex gap-1 justify-end transition-opacity ${isExportOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleCopy}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Copy</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onResend}
                >
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
                <DropdownMenuItem onClick={onExportAll}>
                  Export All Messages
                </DropdownMenuItem>
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
      <div className="text-base text-foreground prose prose-sm dark:prose-invert max-w-none mb-2">
        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Spinner className="size-4" />
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
      <TooltipProvider delayDuration={300}>
        <div className={`flex gap-1 transition-opacity ${isExportOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleCopy}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Copy</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={onTranslate}
              >
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
              <DropdownMenuItem onClick={onExportAll}>
                Export All Messages
              </DropdownMenuItem>
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
})

