import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Search } from 'lucide-react'
import { usePromptStore } from '@/stores/promptStore'
import type { PromptMode } from '@/types'

interface PromptSelectDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  // System prompt
  systemPromptMode: PromptMode
  selectedSystemPromptId: string | null
  customSystemPrompt: string
  // User prompt
  userPromptMode: PromptMode
  selectedUserPromptId: string | null
  customUserPrompt: string
  // Callbacks
  onSystemPromptModeChange: (mode: PromptMode) => void
  onSelectedSystemPromptIdChange: (id: string | null) => void
  onCustomSystemPromptChange: (content: string) => void
  onUserPromptModeChange: (mode: PromptMode) => void
  onSelectedUserPromptIdChange: (id: string | null) => void
  onCustomUserPromptChange: (content: string) => void
}

export function PromptSelectDialog({
  isOpen,
  onOpenChange,
  systemPromptMode,
  selectedSystemPromptId,
  customSystemPrompt,
  userPromptMode,
  selectedUserPromptId,
  customUserPrompt,
  onSystemPromptModeChange,
  onSelectedSystemPromptIdChange,
  onCustomSystemPromptChange,
  onUserPromptModeChange,
  onSelectedUserPromptIdChange,
  onCustomUserPromptChange,
}: PromptSelectDialogProps) {
  const { prompts, ensureLoaded } = usePromptStore()

  // Search queries for filtering
  const [systemPromptSearchQuery, setSystemPromptSearchQuery] = useState('')
  const [userPromptSearchQuery, setUserPromptSearchQuery] = useState('')

  // Load prompts when dialog opens
  useEffect(() => {
    if (isOpen) {
      ensureLoaded()
    }
  }, [isOpen, ensureLoaded])

  // Reset search queries when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSystemPromptSearchQuery('')
      setUserPromptSearchQuery('')
    }
  }, [isOpen])

  // Filter prompts by search query for system prompt (only system prompts)
  const filteredSystemPrompts = useMemo(() => {
    const systemPrompts = prompts.filter((p) => p.is_system)

    if (!systemPromptSearchQuery.trim()) return systemPrompts

    const query = systemPromptSearchQuery.toLowerCase()
    return systemPrompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.content.toLowerCase().includes(query) ||
        (prompt.description && prompt.description.toLowerCase().includes(query))
    )
  }, [prompts, systemPromptSearchQuery])

  // Filter prompts by search query for user prompt (only user prompts)
  const filteredUserPrompts = useMemo(() => {
    const userPrompts = prompts.filter((p) => !p.is_system)

    if (!userPromptSearchQuery.trim()) return userPrompts

    const query = userPromptSearchQuery.toLowerCase()
    return userPrompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.content.toLowerCase().includes(query) ||
        (prompt.description && prompt.description.toLowerCase().includes(query))
    )
  }, [prompts, userPromptSearchQuery])

  // Get selected prompt names for display
  const selectedSystemPromptName = useMemo(() => {
    if (!selectedSystemPromptId) return 'Select a prompt'
    const prompt = prompts.find((p) => p.id === selectedSystemPromptId)
    return prompt?.name || 'Select a prompt'
  }, [prompts, selectedSystemPromptId])

  const selectedUserPromptName = useMemo(() => {
    if (!selectedUserPromptId) return 'Select a prompt'
    const prompt = prompts.find((p) => p.id === selectedUserPromptId)
    return prompt?.name || 'Select a prompt'
  }, [prompts, selectedUserPromptId])

  // Get selected prompt content for preview
  const selectedSystemPromptContent = useMemo(() => {
    if (!selectedSystemPromptId) return ''
    const prompt = prompts.find((p) => p.id === selectedSystemPromptId)
    return prompt?.content || ''
  }, [prompts, selectedSystemPromptId])

  const selectedUserPromptContent = useMemo(() => {
    if (!selectedUserPromptId) return ''
    const prompt = prompts.find((p) => p.id === selectedUserPromptId)
    return prompt?.content || ''
  }, [prompts, selectedUserPromptId])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prompt Settings</DialogTitle>
          <DialogDescription>
            Override the system and user prompts for this conversation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* System Prompt Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">System Prompt</Label>
              <div className="flex gap-3">
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="system-prompt-none"
                    name="system-prompt-mode"
                    checked={systemPromptMode === 'none'}
                    onChange={() => onSystemPromptModeChange('none')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="system-prompt-none" className="cursor-pointer font-normal text-xs">
                    Default
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="system-prompt-existing"
                    name="system-prompt-mode"
                    checked={systemPromptMode === 'existing'}
                    onChange={() => onSystemPromptModeChange('existing')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="system-prompt-existing" className="cursor-pointer font-normal text-xs">
                    Select Existing
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="system-prompt-custom"
                    name="system-prompt-mode"
                    checked={systemPromptMode === 'custom'}
                    onChange={() => onSystemPromptModeChange('custom')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="system-prompt-custom" className="cursor-pointer font-normal text-xs">
                    Custom
                  </Label>
                </div>
              </div>
            </div>

            {/* System Prompt Selection */}
            {systemPromptMode === 'existing' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">{selectedSystemPromptName}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[300px] flex flex-col p-0">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts..."
                        value={systemPromptSearchQuery}
                        onChange={(e) => setSystemPromptSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-[240px]">
                    {filteredSystemPrompts.length > 0 ? (
                      filteredSystemPrompts.map((prompt) => (
                        <DropdownMenuItem
                          key={prompt.id}
                          onClick={() => {
                            onSelectedSystemPromptIdChange(prompt.id)
                            setSystemPromptSearchQuery('')
                          }}
                          className="flex flex-col items-start"
                        >
                          <span className="font-medium">{prompt.name}</span>
                          {prompt.description && (
                            <span className="text-xs text-muted-foreground">
                              {prompt.description}
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No prompts found
                      </div>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* System Prompt Preview/Edit */}
            {systemPromptMode === 'existing' && selectedSystemPromptId && (
              <Textarea
                value={selectedSystemPromptContent}
                readOnly
                rows={4}
                className="font-mono text-sm bg-muted"
              />
            )}
            {systemPromptMode === 'custom' && (
              <Textarea
                placeholder="You are a helpful AI assistant..."
                value={customSystemPrompt}
                onChange={(e) => onCustomSystemPromptChange(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
            )}

            {systemPromptMode === 'none' && (
              <p className="text-xs text-muted-foreground">
                Uses the assistant's default system prompt
              </p>
            )}
          </div>

          {/* User Prompt Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">User Prompt (Optional)</Label>
              <div className="flex gap-3">
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="user-prompt-none"
                    name="user-prompt-mode"
                    checked={userPromptMode === 'none'}
                    onChange={() => onUserPromptModeChange('none')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="user-prompt-none" className="cursor-pointer font-normal text-xs">
                    None
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="user-prompt-existing"
                    name="user-prompt-mode"
                    checked={userPromptMode === 'existing'}
                    onChange={() => onUserPromptModeChange('existing')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="user-prompt-existing" className="cursor-pointer font-normal text-xs">
                    Select Existing
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    id="user-prompt-custom"
                    name="user-prompt-mode"
                    checked={userPromptMode === 'custom'}
                    onChange={() => onUserPromptModeChange('custom')}
                    className="size-3.5 cursor-pointer"
                  />
                  <Label htmlFor="user-prompt-custom" className="cursor-pointer font-normal text-xs">
                    Custom
                  </Label>
                </div>
              </div>
            </div>

            {/* User Prompt Selection */}
            {userPromptMode === 'existing' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="truncate">{selectedUserPromptName}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-[300px] flex flex-col p-0">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts..."
                        value={userPromptSearchQuery}
                        onChange={(e) => setUserPromptSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-[240px]">
                    {filteredUserPrompts.length > 0 ? (
                      filteredUserPrompts.map((prompt) => (
                        <DropdownMenuItem
                          key={prompt.id}
                          onClick={() => {
                            onSelectedUserPromptIdChange(prompt.id)
                            setUserPromptSearchQuery('')
                          }}
                          className="flex flex-col items-start"
                        >
                          <span className="font-medium">{prompt.name}</span>
                          {prompt.description && (
                            <span className="text-xs text-muted-foreground">
                              {prompt.description}
                            </span>
                          )}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No prompts found
                      </div>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* User Prompt Preview/Edit */}
            {userPromptMode === 'existing' && selectedUserPromptId && (
              <Textarea
                value={selectedUserPromptContent}
                readOnly
                rows={3}
                className="font-mono text-sm bg-muted"
              />
            )}
            {userPromptMode === 'custom' && (
              <>
                <Textarea
                  placeholder="Additional context or instructions..."
                  value={customUserPrompt}
                  onChange={(e) => onCustomUserPromptChange(e.target.value)}
                  rows={4}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  This will be prepended to user messages
                </p>
              </>
            )}

            {userPromptMode === 'none' && (
              <p className="text-xs text-muted-foreground">
                No user prompt will be applied
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


