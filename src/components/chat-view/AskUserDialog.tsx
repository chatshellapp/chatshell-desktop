// Dialog for the `ask_user` tool: the model asks the user one to four
// questions mid-turn. Fed by the ask-user store (FIFO, oldest first);
// answers go back through `resolve_ask_user`. Each question offers its
// options (radio or checkbox) plus a text box that is always available:
// the answer itself when nothing is selected, otherwise a note. Never
// answered automatically: closing the dialog declines, and the backend
// closes it when the turn is stopped. Buttons arm after a short delay so
// a composer keystroke cannot answer reflexively. The backend validates
// answers against the request before the model sees them.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { MessageCircleQuestionMark } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useAskUserStore, type AskUserAnswer, type AskUserQuestion } from '@/stores/askUserStore'
import { logger } from '@/lib/logger'

const ARM_DELAY_MS = 500

type Entry = { selected: string[]; text: string }
type Entries = Record<string, Entry>

/** The answers to send: one per question, in question order. */
export function buildAnswers(questions: AskUserQuestion[], entries: Entries): AskUserAnswer[] {
  return questions.map((question) => {
    const entry = entries[question.id] ?? { selected: [], text: '' }
    const text = entry.text.trim()
    return { question_id: question.id, selected: entry.selected, text: text || null }
  })
}

function QuestionField({
  question,
  entry,
  onChange,
  disabled,
}: {
  question: AskUserQuestion
  entry: Entry
  onChange: (entry: Entry) => void
  disabled: boolean
}) {
  const { t } = useTranslation('chat')
  const baseId = `ask-user-${question.id}`
  const hasOptions = question.options.length > 0
  const questionId = `${baseId}-question`

  const optionLabel = (option: AskUserQuestion['options'][number]) => (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-2">
        {option.label}
        {option.recommended && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {t('askUser.recommended')}
          </Badge>
        )}
      </span>
      {option.description && (
        <span className="text-xs text-muted-foreground">{option.description}</span>
      )}
    </span>
  )

  return (
    <fieldset className="grid gap-2" aria-labelledby={questionId}>
      <div className="grid gap-1">
        {question.header && (
          <Badge variant="outline" className="w-fit">
            {question.header}
          </Badge>
        )}
        <p id={questionId} className="text-sm font-medium whitespace-pre-wrap">
          {question.question}
        </p>
      </div>

      {hasOptions && !question.multi && (
        <RadioGroup
          value={entry.selected[0] ?? ''}
          onValueChange={(value) => onChange({ ...entry, selected: value ? [value] : [] })}
          disabled={disabled}
          className="gap-2"
        >
          {question.options.map((option) => {
            const id = `${baseId}-${option.id}`
            return (
              <div key={option.id} className="flex items-start gap-2">
                <RadioGroupItem id={id} value={option.id} className="mt-0.5" />
                <Label htmlFor={id} className="font-normal">
                  {optionLabel(option)}
                </Label>
              </div>
            )
          })}
        </RadioGroup>
      )}

      {hasOptions && question.multi && (
        <div className="grid gap-2">
          {question.options.map((option) => {
            const id = `${baseId}-${option.id}`
            const checked = entry.selected.includes(option.id)
            return (
              <div key={option.id} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={disabled}
                  className="mt-0.5"
                  onCheckedChange={(on) =>
                    onChange({
                      ...entry,
                      selected:
                        on === true
                          ? [...entry.selected, option.id]
                          : entry.selected.filter((s) => s !== option.id),
                    })
                  }
                />
                <Label htmlFor={id} className="font-normal">
                  {optionLabel(option)}
                </Label>
              </div>
            )
          })}
        </div>
      )}

      <Textarea
        aria-label={
          hasOptions
            ? t('askUser.textLabel', { question: question.header ?? question.question })
            : question.question
        }
        rows={hasOptions ? 1 : 3}
        className="min-h-9 text-sm"
        placeholder={
          !hasOptions
            ? t('askUser.answerPlaceholder')
            : entry.selected.length > 0
              ? t('askUser.notePlaceholder')
              : t('askUser.otherPlaceholder')
        }
        value={entry.text}
        disabled={disabled}
        onChange={(e) => onChange({ ...entry, text: e.target.value })}
      />
    </fieldset>
  )
}

export function AskUserDialog() {
  const { t } = useTranslation('chat')
  const queue = useAskUserStore((state) => state.pending)
  const remove = useAskUserStore((state) => state.remove)
  const pending = queue[0]
  const [armed, setArmed] = useState(false)
  const [entries, setEntries] = useState<Entries>({})

  useEffect(() => {
    if (!pending) return
    setArmed(false)
    setEntries({})
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [pending])

  if (!pending) return null

  const respond = async (action: 'submit' | 'discuss' | 'decline') => {
    const requestId = pending.requestId
    const answers = action === 'decline' ? null : buildAnswers(pending.questions, entries)
    remove(requestId)
    try {
      await invoke('resolve_ask_user', { requestId, action, answers })
    } catch (e) {
      logger.error('[AskUserDialog] resolve_ask_user failed:', e)
    }
  }

  const count = pending.questions.length

  return (
    <Dialog open onOpenChange={(open) => !open && respond('decline')}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircleQuestionMark className="size-5 shrink-0" />
            {t('askUser.title', { count })}
          </DialogTitle>
          <DialogDescription className="text-left">{t('askUser.description')}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (armed) void respond('submit')
          }}
        >
          {pending.questions.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              entry={entries[question.id] ?? { selected: [], text: '' }}
              disabled={!armed}
              onChange={(entry) => setEntries((prev) => ({ ...prev, [question.id]: entry }))}
            />
          ))}
        </form>

        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {t('askUser.queueCount', { count: queue.length - 1 })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={!armed} onClick={() => respond('discuss')}>
            {t('askUser.discuss')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!armed} onClick={() => respond('decline')}>
              {t('askUser.skip')}
            </Button>
            <Button disabled={!armed} onClick={() => respond('submit')}>
              {t('askUser.submit')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
