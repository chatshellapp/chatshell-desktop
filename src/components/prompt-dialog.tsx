import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Loader2, ChevronsUpDown, Check } from 'lucide-react'
import type { Prompt, CreatePromptRequest } from '@/types'
import { usePromptStore } from '@/stores/promptStore'
import { logger } from '@/lib/logger'

interface PromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prompt?: Prompt | null
  mode?: 'create' | 'edit'
}

export function PromptDialog({ open, onOpenChange, prompt, mode = 'create' }: PromptDialogProps) {
  const { t } = useTranslation('prompts')
  const { prompts, createPrompt, updatePrompt, ensureLoaded } = usePromptStore()

  // Form state
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [isSystem, setIsSystem] = useState(true)

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryComboboxOpen, setCategoryComboboxOpen] = useState(false)
  const [categoryInputValue, setCategoryInputValue] = useState('')

  // Load prompts on mount to get existing categories
  useEffect(() => {
    if (open) {
      ensureLoaded()
    }
  }, [open, ensureLoaded])

  // Get unique category names from existing prompts
  const existingCategories = useMemo(() => {
    const categories = new Set<string>()
    prompts.forEach((p) => {
      if (p.category) {
        categories.add(p.category)
      }
    })
    return Array.from(categories).sort()
  }, [prompts])

  // Filter categories by input value
  const filteredCategories = useMemo(() => {
    if (!categoryInputValue.trim()) return existingCategories
    const query = categoryInputValue.toLowerCase()
    return existingCategories.filter((cat) => cat.toLowerCase().includes(query))
  }, [existingCategories, categoryInputValue])

  // Initialize form when prompt changes or dialog opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && prompt) {
        setName(prompt.name)
        setContent(prompt.content)
        setDescription(prompt.description || '')
        setCategory(prompt.category || '')
        setIsSystem(prompt.is_system)
      } else {
        // Reset form for create mode
        setName('')
        setContent('')
        setDescription('')
        setCategory('')
        setIsSystem(true)
      }
      setCategoryInputValue('')
      setError(null)
    }
  }, [open, mode, prompt])

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('nameIsRequired'))
      return
    }

    if (!content.trim()) {
      setError(t('contentIsRequired'))
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
        is_system: isSystem,
      }

      if (mode === 'edit' && prompt) {
        await updatePrompt(prompt.id, req)
        onOpenChange(false)
      } else {
        await createPrompt(req)
        onOpenChange(false)
      }
    } catch (err) {
      logger.error('Failed to save prompt:', err)
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
          <DialogTitle>{mode === 'edit' ? t('editPrompt') : t('newPrompt')}</DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? t('editPromptDescription', 'Modify the prompt details below.')
              : t('newPromptDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">{error}</div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">{t('name', { ns: 'common' })} *</Label>
            <Input
              id="name"
              placeholder={t('promptNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>{t('promptType')} *</Label>
            <RadioGroup
              value={isSystem ? 'system' : 'user'}
              onValueChange={(value) => setIsSystem(value === 'system')}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="system" id="prompt-type-system" />
                <Label htmlFor="prompt-type-system" className="font-normal cursor-pointer">
                  {t('systemPrompt')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="user" id="prompt-type-user" />
                <Label htmlFor="prompt-type-user" className="font-normal cursor-pointer">
                  {t('userPrompt')}
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {isSystem ? t('willBeUsedAsSystemInstruction') : t('willBeUsedAsUserMessage')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">{t('category')}</Label>
            <Popover open={categoryComboboxOpen} onOpenChange={setCategoryComboboxOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={categoryComboboxOpen}
                  className="w-full justify-between"
                >
                  <span className="truncate">{category || t('selectCategory')}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder={t('searchOrTypeNewCategory')}
                    value={categoryInputValue}
                    onValueChange={setCategoryInputValue}
                  />
                  <CommandList>
                    <CommandEmpty>
                      <div className="py-2 px-2">
                        {categoryInputValue.trim() ? (
                          <Button
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => {
                              setCategory(categoryInputValue.trim())
                              setCategoryComboboxOpen(false)
                              setCategoryInputValue('')
                            }}
                          >
                            {t('createNewCategory', { name: categoryInputValue.trim() })}
                          </Button>
                        ) : (
                          <div className="text-sm text-muted-foreground text-center">
                            {t('typeToCreateCategory')}
                          </div>
                        )}
                      </div>
                    </CommandEmpty>
                    <CommandGroup>
                      {filteredCategories.map((cat) => (
                        <CommandItem
                          key={cat}
                          value={cat}
                          onSelect={() => {
                            setCategory(cat)
                            setCategoryComboboxOpen(false)
                            setCategoryInputValue('')
                          }}
                        >
                          {cat}
                          <Check
                            className={
                              category === cat ? 'ml-auto opacity-100' : 'ml-auto opacity-0'
                            }
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">{t('organizeByCategory')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('description', { ns: 'common' })}</Label>
            <Input
              id="description"
              placeholder={t('descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">{t('promptContent')} *</Label>
            <Textarea
              id="content"
              placeholder={t('contentPlaceholder')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('contentHelp')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('saving', { ns: 'common' })}
              </>
            ) : mode === 'edit' ? (
              t('saveChanges', { ns: 'common' })
            ) : (
              t('createPrompt')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
