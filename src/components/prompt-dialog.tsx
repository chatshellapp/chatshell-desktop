import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogHeader,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import type { Prompt, CreatePromptRequest } from '@/types'
import { usePromptStore } from '@/stores/promptStore'

interface PromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prompt?: Prompt | null
  mode?: 'create' | 'edit'
}

export function PromptDialog({
  open,
  onOpenChange,
  prompt,
  mode = 'create',
}: PromptDialogProps) {
  const { createPrompt, updatePrompt } = usePromptStore()

  // Form state
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize form when prompt changes or dialog opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && prompt) {
        setName(prompt.name)
        setContent(prompt.content)
        setDescription(prompt.description || '')
        setCategory(prompt.category || '')
      } else {
        // Reset form for create mode
        setName('')
        setContent('')
        setDescription('')
        setCategory('')
      }
      setError(null)
    }
  }, [open, mode, prompt])

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    if (!content.trim()) {
      setError('Content is required')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const req: CreatePromptRequest = {
        name: name.trim(),
        content: content.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        is_system: false,
      }

      if (mode === 'edit' && prompt) {
        await updatePrompt(prompt.id, req)
        onOpenChange(false)
      } else {
        await createPrompt(req)
        onOpenChange(false)
      }
    } catch (err) {
      console.error('Failed to save prompt:', err)
      setError(String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit Prompt' : 'Create New Prompt'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Modify the prompt details below.'
              : 'Add a new prompt to your library for quick reuse.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Code Review Assistant"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              placeholder="e.g., Development, Writing, Analysis"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Organize prompts by category (optional)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Brief description of this prompt"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Content *</Label>
            <Textarea
              id="content"
              placeholder="Enter your prompt content here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              This is the actual prompt text that will be used
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : mode === 'edit' ? (
              'Save Changes'
            ) : (
              'Create Prompt'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

