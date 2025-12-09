import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CONTEXT_COUNT_OPTIONS } from '@/types'
import { cn } from '@/lib/utils'

interface ContextCountDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  contextMessageCount: number | null
  onSave: (count: number | null) => void
}

export function ContextCountDialog({
  isOpen,
  onOpenChange,
  contextMessageCount,
  onSave,
}: ContextCountDialogProps) {
  const [selectedValue, setSelectedValue] = useState<number | null>(contextMessageCount)
  const [customValue, setCustomValue] = useState<string>('')
  const [isCustom, setIsCustom] = useState(false)

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedValue(contextMessageCount)
      // Check if current value is a preset option
      const isPresetValue = CONTEXT_COUNT_OPTIONS.some((opt) => opt.value === contextMessageCount)
      setIsCustom(!isPresetValue && contextMessageCount !== null)
      if (!isPresetValue && contextMessageCount !== null) {
        setCustomValue(String(contextMessageCount))
      } else {
        setCustomValue('')
      }
    }
  }, [isOpen, contextMessageCount])

  const handleOptionSelect = (value: number | null) => {
    setSelectedValue(value)
    setIsCustom(false)
    setCustomValue('')
  }

  const handleCustomToggle = () => {
    setIsCustom(true)
    setSelectedValue(null)
  }

  const handleApply = () => {
    if (isCustom) {
      const parsed = parseInt(customValue, 10)
      if (!isNaN(parsed) && parsed > 0) {
        onSave(parsed)
      }
    } else {
      onSave(selectedValue)
    }
    onOpenChange(false)
  }

  const isValidCustomValue = () => {
    if (!isCustom) return true
    const parsed = parseInt(customValue, 10)
    return !isNaN(parsed) && parsed > 0
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Context Message Count</DialogTitle>
          <DialogDescription>
            Set how many previous messages to include as context. Unlimited includes all messages.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-4">
          {CONTEXT_COUNT_OPTIONS.map((option) => (
            <button
              key={option.value ?? 'unlimited'}
              onClick={() => handleOptionSelect(option.value)}
              className={cn(
                'flex items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                selectedValue === option.value && !isCustom
                  ? 'border-primary bg-accent'
                  : 'border-border'
              )}
            >
              <span className="font-medium">{option.label}</span>
              {option.value === null && (
                <span className="text-xs text-muted-foreground">Default</span>
              )}
            </button>
          ))}

          {/* Custom option */}
          <button
            onClick={handleCustomToggle}
            className={cn(
              'flex items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-accent',
              isCustom ? 'border-primary bg-accent' : 'border-border'
            )}
          >
            <span className="font-medium">Custom</span>
          </button>

          {isCustom && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Label htmlFor="custom-count" className="shrink-0">
                Messages:
              </Label>
              <Input
                id="custom-count"
                type="number"
                min={1}
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder="Enter number"
                className="h-8"
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!isValidCustomValue()}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
