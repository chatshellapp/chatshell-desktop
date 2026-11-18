import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Search, MessageSquare, Plug, Loader2, ArrowLeft } from 'lucide-react'
import { logger } from '@/lib/logger'
import { usePromptStore } from '@/stores/promptStore'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

/** A prompt an MCP server offers (FR-13); mirrors the backend type. */
export interface McpPromptInfo {
  name: string
  title?: string | null
  description?: string | null
  arguments: {
    name: string
    title?: string | null
    description?: string | null
    required: boolean
  }[]
}

export interface McpServerPrompts {
  server_id: string
  server_name: string
  prompts: McpPromptInfo[]
}

interface UserPromptQuickSelectDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSelectPrompt: (promptId: string, content: string) => void
  /** MCP servers enabled for this chat; their prompts are listed too. */
  mcpServerIds?: string[]
}

type McpChoice = { server: McpServerPrompts; prompt: McpPromptInfo }

export function UserPromptQuickSelectDialog({
  isOpen,
  onOpenChange,
  onSelectPrompt,
  mcpServerIds,
}: UserPromptQuickSelectDialogProps) {
  const { t } = useTranslation('prompts')
  const { prompts, ensureLoaded } = usePromptStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [mcpPrompts, setMcpPrompts] = useState<McpServerPrompts[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [choice, setChoice] = useState<McpChoice | null>(null)
  const [args, setArgs] = useState<Record<string, string>>({})
  const [inserting, setInserting] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const serverKey = (mcpServerIds ?? []).join(',')

  // Load prompts when dialog opens
  useEffect(() => {
    if (isOpen) {
      ensureLoaded()
    }
  }, [isOpen, ensureLoaded])

  // MCP prompts of the chat's servers, fetched each time the dialog opens
  useEffect(() => {
    if (!isOpen || !serverKey) {
      setMcpPrompts([])
      return
    }
    let cancelled = false
    setMcpLoading(true)
    invoke<McpServerPrompts[]>('list_mcp_prompts', { serverIds: serverKey.split(',') })
      .then((result) => {
        if (!cancelled) setMcpPrompts(result)
      })
      .catch((e) => logger.warn('[UserPromptQuickSelectDialog] list_mcp_prompts failed:', e))
      .finally(() => {
        if (!cancelled) setMcpLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, serverKey])

  // Reset search when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      setChoice(null)
      setArgs({})
      setMcpError(null)
    }
  }, [isOpen])

  const filteredMcp = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return mcpPrompts
      .map((server) => ({
        ...server,
        prompts: query
          ? server.prompts.filter((p) =>
              [p.name, p.title ?? '', p.description ?? ''].some((s) =>
                s.toLowerCase().includes(query)
              )
            )
          : server.prompts,
      }))
      .filter((server) => server.prompts.length > 0)
  }, [mcpPrompts, searchQuery])

  const insertMcp = async (picked: McpChoice, values: Record<string, string>) => {
    const missing = picked.prompt.arguments.find((a) => a.required && !values[a.name]?.trim())
    if (missing) {
      setMcpError(t('mcpPromptMissingArgument', { argument: missing.title ?? missing.name }))
      return
    }
    setInserting(true)
    setMcpError(null)
    try {
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''))
      const text = await invoke<string>('get_mcp_prompt', {
        serverId: picked.server.server_id,
        name: picked.prompt.name,
        arguments: filled,
      })
      onSelectPrompt(`mcp:${picked.server.server_id}/${picked.prompt.name}`, text)
      onOpenChange(false)
    } catch (e) {
      setMcpError(String(e))
    } finally {
      setInserting(false)
    }
  }

  const pickMcp = (picked: McpChoice) => {
    if (picked.prompt.arguments.length === 0) {
      void insertMcp(picked, {})
    } else {
      setChoice(picked)
      setArgs({})
      setMcpError(null)
    }
  }

  // Filter to only user prompts (is_system === false)
  const filteredPrompts = useMemo(() => {
    const userPrompts = prompts.filter((p) => !p.is_system)

    if (!searchQuery.trim()) return userPrompts

    const query = searchQuery.toLowerCase()
    return userPrompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.content.toLowerCase().includes(query) ||
        (prompt.description && prompt.description.toLowerCase().includes(query))
    )
  }, [prompts, searchQuery])

  // Group by category
  const groupedPrompts = useMemo(() => {
    const groups = new Map<string, typeof filteredPrompts>()

    filteredPrompts.forEach((prompt) => {
      const category = prompt.category || 'Uncategorized'
      if (!groups.has(category)) {
        groups.set(category, [])
      }
      groups.get(category)!.push(prompt)
    })

    return Array.from(groups.entries()).sort((a, b) => {
      // Put Uncategorized at the end
      if (a[0] === 'Uncategorized') return 1
      if (b[0] === 'Uncategorized') return -1
      return a[0].localeCompare(b[0])
    })
  }, [filteredPrompts])

  const handleSelect = (promptId: string, content: string) => {
    onSelectPrompt(promptId, content)
    onOpenChange(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] max-h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>{t('selectUserPrompt')}</DialogTitle>
          <DialogDescription>{t('choosePromptTemplate')}</DialogDescription>
        </DialogHeader>

        {choice && (
          <form
            className="grid gap-3 px-4 pb-4"
            onSubmit={(e) => {
              e.preventDefault()
              void insertMcp(choice, args)
            }}
          >
            <div className="text-sm font-medium">
              {choice.server.server_name} · {choice.prompt.title ?? choice.prompt.name}
            </div>
            {choice.prompt.description && (
              <p className="text-xs text-muted-foreground">{choice.prompt.description}</p>
            )}
            {choice.prompt.arguments.map((arg) => (
              <div key={arg.name} className="grid gap-1.5">
                <Label htmlFor={`mcp-prompt-${arg.name}`}>
                  {arg.title ?? arg.name}
                  {arg.required && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id={`mcp-prompt-${arg.name}`}
                  value={args[arg.name] ?? ''}
                  onChange={(e) => setArgs((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                />
                {arg.description && (
                  <p className="text-xs text-muted-foreground">{arg.description}</p>
                )}
              </div>
            ))}
            {mcpError && (
              <p role="alert" className="text-xs text-destructive">
                {mcpError}
              </p>
            )}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setChoice(null)}>
                <ArrowLeft className="size-4" />
                {t('mcpPromptBack')}
              </Button>
              <Button type="submit" disabled={inserting}>
                {inserting && <Loader2 className="size-4 animate-spin" />}
                {t('mcpPromptInsert')}
              </Button>
            </div>
          </form>
        )}

        {/* Search */}
        <div className={cn('px-4 pb-3', choice && 'hidden')}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={t('searchPrompts')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        {/* Prompt List */}
        <div className={cn('flex-1 overflow-y-auto px-2 pb-4 min-h-0', choice && 'hidden')}>
          {filteredMcp.map((server) => (
            <div key={server.server_id} className="mb-3">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {t('mcpPromptGroup', { server: server.server_name })}
              </div>
              <div className="space-y-1">
                {server.prompts.map((prompt) => (
                  <button
                    key={prompt.name}
                    disabled={inserting}
                    onClick={() => pickMcp({ server, prompt })}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md',
                      'hover:bg-accent transition-colors',
                      'focus:outline-none focus:bg-accent'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Plug className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {prompt.title ?? prompt.name}
                        </div>
                        {prompt.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {prompt.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {mcpLoading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t('mcpPromptsLoading')}
            </div>
          )}
          {mcpError && !choice && (
            <p role="alert" className="px-3 py-1 text-xs text-destructive">
              {mcpError}
            </p>
          )}
          {groupedPrompts.length > 0 ? (
            groupedPrompts.map(([category, categoryPrompts]) => (
              <div key={category} className="mb-3">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {category}
                </div>
                <div className="space-y-1">
                  {categoryPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handleSelect(prompt.id, prompt.content)}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-md',
                        'hover:bg-accent transition-colors',
                        'focus:outline-none focus:bg-accent'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{prompt.name}</div>
                          {prompt.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {prompt.description}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                            {prompt.content}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? t('noPromptsFound') : t('noUserPromptsAvailable')}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {t('createUserPromptsInLibrary')}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
