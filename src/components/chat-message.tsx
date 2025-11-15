import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Bot, Copy, Languages, Undo, Scan } from "lucide-react"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import gptAvatar from "@/assets/models/gpt.png"
import { Spinner } from "@/components/ui/spinner"

interface ChatMessageProps {
  role: "user" | "assistant"
  content: string
  timestamp?: string
  modelName?: string
  modelAvatar?: string
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

export function ChatMessage({
  role,
  content,
  timestamp,
  modelName = "GPT-4",
  modelAvatar = gptAvatar,
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

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    onCopy?.()
  }

  if (role === "user") {
    const alignClass = userMessageAlign === "right" ? "justify-end" : "justify-start"
    const backgroundClass = userMessageShowBackground ? "bg-muted/50" : ""
    
    return (
      <div className={`group flex flex-col px-4 my-1`}>
        {timestamp && (
          <div className={`flex ${alignClass} mb-1`}>
            <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
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
    <div className="group px-4 py-2 mx-4 my-1">
      <div className="flex items-center gap-2 mb-2">
        <Avatar className="h-4 w-4">
          <AvatarImage src={modelAvatar} />
          <AvatarFallback className="bg-green-500/10">
            <Bot className="h-3 w-3 text-green-600" />
          </AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground">{modelName}</span>
        {timestamp && (
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
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
            components={{
              code(props) {
                const { node, inline, className, children, ...rest } = props as any
                return (
                  <code
                    className={`${className || ''} ${
                      inline
                        ? 'px-1.5 py-0.5 rounded-md bg-muted text-sm'
                        : 'block p-3 rounded-md bg-muted overflow-x-auto'
                    }`}
                    {...rest}
                  >
                    {children}
                  </code>
                )
              },
              pre({ children }) {
                return <pre className="my-2">{children}</pre>
              },
              p({ children }) {
                return <p className="mb-2 last:mb-0">{children}</p>
              },
              ul({ children }) {
                return <ul className="list-disc list-inside mb-2">{children}</ul>
              },
              ol({ children }) {
                return <ol className="list-decimal list-inside mb-2">{children}</ol>
              },
              li({ children }) {
                return <li className="mb-1">{children}</li>
              },
              blockquote({ children }) {
                return <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2">{children}</blockquote>
              },
              h1({ children }) {
                return <h1 className="text-2xl font-bold mb-2 mt-4">{children}</h1>
              },
              h2({ children }) {
                return <h2 className="text-xl font-bold mb-2 mt-3">{children}</h2>
              },
              h3({ children }) {
                return <h3 className="text-lg font-bold mb-2 mt-2">{children}</h3>
              },
              table({ children }) {
                return <table className="border-collapse border border-border my-2">{children}</table>
              },
              thead({ children }) {
                return <thead className="bg-muted">{children}</thead>
              },
              th({ children }) {
                return <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>
              },
              td({ children }) {
                return <td className="border border-border px-3 py-2">{children}</td>
              },
            }}
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
}

