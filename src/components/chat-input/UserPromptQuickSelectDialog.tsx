import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search, MessageSquare } from 'lucide-react'
import { usePromptStore } from '@/stores/promptStore'
import { cn } from '@/lib/utils'

interface UserPromptQuickSelectDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSelectPrompt: (promptId: string, content: string) => void
}

export function UserPromptQuickSelectDialog({
  isOpen,
  onOpenChange,
  onSelectPrompt,
}: UserPromptQuickSelectDialogProps) {
  const { prompts, ensureLoaded } = usePromptStore()
  const [searchQuery, setSearchQuery] = useState('')

  // Load prompts when dialog opens
  useEffect(() => {
    if (isOpen) {
      ensureLoaded()
    }
  }, [isOpen, ensureLoaded])

  // Reset search when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
    }
  }, [isOpen])

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
          <DialogTitle>Select User Prompt</DialogTitle>
          <DialogDescription>Choose a prompt template to fill in the input</DialogDescription>
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
                {searchQuery ? 'No prompts found' : 'No user prompts available'}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Create user prompts in the Library
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
