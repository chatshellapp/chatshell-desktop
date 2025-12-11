import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Search, SquareTerminal, RotateCcw, Pencil } from 'lucide-react'
import { usePromptStore } from '@/stores/promptStore'
import { cn } from '@/lib/utils'
import type { PromptMode } from '@/types'

interface SystemPromptDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  systemPromptMode: PromptMode
  selectedSystemPromptId: string | null
  customSystemPrompt: string
  onSystemPromptModeChange: (mode: PromptMode) => void
  onSelectedSystemPromptIdChange: (id: string | null) => void
  onCustomSystemPromptChange: (content: string) => void
}

export function SystemPromptDialog({
  isOpen,
  onOpenChange,
  systemPromptMode,
  selectedSystemPromptId,
  customSystemPrompt,
  onSystemPromptModeChange,
  onSelectedSystemPromptIdChange,
  onCustomSystemPromptChange,
}: SystemPromptDialogProps) {
  const { prompts, ensureLoaded } = usePromptStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [customText, setCustomText] = useState('')

  // Load prompts when dialog opens
  useEffect(() => {
    if (isOpen) {
      ensureLoaded()
      // Initialize custom mode state
      setIsCustomMode(systemPromptMode === 'custom')
      setCustomText(customSystemPrompt)
    }
  }, [isOpen, ensureLoaded, systemPromptMode, customSystemPrompt])

  // Reset search when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      setIsCustomMode(false)
    }
  }, [isOpen])

  // Filter to only system prompts (is_system === true)
  const filteredPrompts = useMemo(() => {
    const systemPrompts = prompts.filter((p) => p.is_system)

    if (!searchQuery.trim()) return systemPrompts

    const query = searchQuery.toLowerCase()
    return systemPrompts.filter(
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

  // Get selected prompt name for display
  const selectedPromptName = useMemo(() => {
    if (!selectedSystemPromptId) return null
    const prompt = prompts.find((p) => p.id === selectedSystemPromptId)
    return prompt?.name || null
  }, [prompts, selectedSystemPromptId])

  const handleSelectDefault = () => {
    onSystemPromptModeChange('none')
    onSelectedSystemPromptIdChange(null)
    onOpenChange(false)
  }

  const handleSelectPrompt = (promptId: string) => {
    onSystemPromptModeChange('existing')
    onSelectedSystemPromptIdChange(promptId)
    onOpenChange(false)
  }

  const handleEnterCustomMode = () => {
    setIsCustomMode(true)
    setCustomText(customSystemPrompt)
  }

  const handleSaveCustom = () => {
    onSystemPromptModeChange('custom')
    onCustomSystemPromptChange(customText)
    onOpenChange(false)
  }

  const handleCancelCustom = () => {
    setIsCustomMode(false)
    setCustomText(customSystemPrompt)
  }

  // Custom mode view
  if (isCustomMode) {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[600px] max-h-[70vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>Custom System Prompt</DialogTitle>
            <DialogDescription>
              Enter a custom system prompt for this conversation
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 px-4 py-3 min-h-0">
            <Textarea
              placeholder="You are a helpful AI assistant..."
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={12}
              className="font-mono text-sm resize-none"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 px-4 pb-4">
            <button
              onClick={handleCancelCustom}
              className="px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveCustom}
              disabled={!customText.trim()}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Apply
            </button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // List view
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] max-h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>System Prompt</DialogTitle>
          <DialogDescription>
            Override the system prompt for this conversation
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        {/* Prompt List */}
        <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0">
          {/* Default Option */}
          {!searchQuery && (
            <div className="mb-3">
              <div className="space-y-1">
                <button
                  onClick={handleSelectDefault}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md',
                    'hover:bg-accent transition-colors',
                    'focus:outline-none focus:bg-accent',
                    systemPromptMode === 'none' && 'bg-accent'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RotateCcw className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">Default</div>
                      <div className="text-xs text-muted-foreground">
                        Use the assistant's default system prompt
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={handleEnterCustomMode}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md',
                    'hover:bg-accent transition-colors',
                    'focus:outline-none focus:bg-accent',
                    systemPromptMode === 'custom' && 'bg-accent'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Pencil className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">Custom</div>
                      <div className="text-xs text-muted-foreground">
                        {systemPromptMode === 'custom' && customSystemPrompt
                          ? customSystemPrompt.length > 60
                            ? customSystemPrompt.substring(0, 60) + '...'
                            : customSystemPrompt
                          : 'Write your own system prompt'}
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Prompt Categories */}
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
                      onClick={() => handleSelectPrompt(prompt.id)}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-md',
                        'hover:bg-accent transition-colors',
                        'focus:outline-none focus:bg-accent',
                        systemPromptMode === 'existing' &&
                          selectedSystemPromptId === prompt.id &&
                          'bg-accent'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <SquareTerminal className="size-4 mt-0.5 text-muted-foreground shrink-0" />
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
          ) : searchQuery ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <SquareTerminal className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No prompts found</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <SquareTerminal className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No system prompts available</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Create system prompts in the Library
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
