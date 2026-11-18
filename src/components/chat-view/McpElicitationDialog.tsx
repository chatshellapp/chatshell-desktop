// Dialog for MCP elicitation (FR-12): a server asks the user for input
// during a call, as a form or a link to open. Fed by the elicitation store
// (FIFO, oldest first); answers go back through `resolve_mcp_elicitation`.
// Never answered automatically: closing the dialog declines, and the
// backend declines on its own after a timeout. Buttons arm after a short
// delay so a composer keystroke cannot answer reflexively. The backend
// validates and scans accepted content before it reaches the server.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink, MessageSquareText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useElicitationStore,
  type ElicitationProperty,
  type ElicitationSchema,
} from '@/stores/elicitationStore'
import { logger } from '@/lib/logger'

const ARM_DELAY_MS = 500

type Values = Record<string, string | boolean | string[]>

type Option = { value: string | number; label: string }

function enumOptions(property: ElicitationProperty): Option[] | null {
  if (property.enum) {
    return property.enum.map((value, i) => ({
      value,
      label: property.enumNames?.[i] ?? String(value),
    }))
  }
  if (property.oneOf) {
    return property.oneOf.map((o) => ({ value: o.const, label: o.title ?? String(o.const) }))
  }
  return null
}

function itemOptions(property: ElicitationProperty): Option[] {
  const items = property.items
  if (items?.enum) return items.enum.map((value) => ({ value, label: value }))
  if (items?.anyOf) return items.anyOf.map((o) => ({ value: o.const, label: o.title ?? o.const }))
  return []
}

function initialValues(schema: ElicitationSchema): Values {
  const values: Values = {}
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const fallback = property.default
    if (property.type === 'boolean') {
      values[name] = typeof fallback === 'boolean' ? fallback : false
    } else if (property.type === 'array') {
      values[name] = Array.isArray(fallback) ? fallback.map(String) : []
    } else {
      values[name] = fallback === undefined || fallback === null ? '' : String(fallback)
    }
  }
  return values
}

/** Build the answer object, or the first field error. Empty optional
 * fields are left out; numbers are parsed by type. */
export function buildContent(
  schema: ElicitationSchema,
  values: Values
): { content: Record<string, unknown> } | { error: string } {
  const required = new Set(schema.required ?? [])
  const content: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const value = values[name]
    if (property.type === 'boolean') {
      content[name] = value === true
      continue
    }
    if (property.type === 'array') {
      const list = Array.isArray(value) ? value : []
      if (list.length > 0 || required.has(name)) content[name] = list
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) {
      if (required.has(name)) return { error: name }
      continue
    }
    if (property.type === 'number' || property.type === 'integer') {
      const n = Number(text)
      if (!Number.isFinite(n) || (property.type === 'integer' && !Number.isInteger(n))) {
        return { error: name }
      }
      content[name] = n
      continue
    }
    const options = enumOptions(property)
    const match = options?.find((o) => String(o.value) === text)
    content[name] = match ? match.value : text
  }
  return { content }
}

function Field({
  name,
  property,
  required,
  value,
  onChange,
  disabled,
}: {
  name: string
  property: ElicitationProperty
  required: boolean
  value: string | boolean | string[]
  onChange: (value: string | boolean | string[]) => void
  disabled: boolean
}) {
  const id = `elicitation-${name}`
  const label = (
    <Label htmlFor={id}>
      {property.title ?? name}
      {required && <span className="text-destructive"> *</span>}
    </Label>
  )
  const help = property.description ? (
    <p className="text-xs text-muted-foreground">{property.description}</p>
  ) : null

  if (property.type === 'boolean') {
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={value === true}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          {label}
        </div>
        {help}
      </div>
    )
  }

  if (property.type === 'array') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="grid gap-1.5">
        {label}
        {itemOptions(property).map((option) => {
          const optionId = `${id}-${option.value}`
          const checked = selected.includes(String(option.value))
          return (
            <div key={optionId} className="flex items-center gap-2">
              <Checkbox
                id={optionId}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(on) =>
                  onChange(
                    on === true
                      ? [...selected, String(option.value)]
                      : selected.filter((v) => v !== String(option.value))
                  )
                }
              />
              <Label htmlFor={optionId} className="font-normal">
                {option.label}
              </Label>
            </div>
          )
        })}
        {help}
      </div>
    )
  }

  const options = enumOptions(property)
  if (options) {
    return (
      <div className="grid gap-1.5">
        {label}
        <select
          id={id}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" />
          {options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  const numeric = property.type === 'number' || property.type === 'integer'
  const inputType = numeric
    ? 'number'
    : property.format === 'email'
      ? 'email'
      : property.format === 'uri'
        ? 'url'
        : property.format === 'date'
          ? 'date'
          : 'text'
  return (
    <div className="grid gap-1.5">
      {label}
      <Input
        id={id}
        type={inputType}
        value={typeof value === 'string' ? value : ''}
        min={property.minimum}
        max={property.maximum}
        maxLength={property.maxLength}
        step={property.type === 'integer' ? 1 : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {help}
    </div>
  )
}

export function McpElicitationDialog() {
  const { t } = useTranslation('chat')
  const queue = useElicitationStore((state) => state.pending)
  const remove = useElicitationStore((state) => state.remove)
  const pending = queue[0]
  const [armed, setArmed] = useState(false)
  const [values, setValues] = useState<Values>({})
  const [error, setError] = useState<string | null>(null)
  const schema = useMemo(() => (pending?.mode === 'form' ? pending.schema : null), [pending])

  useEffect(() => {
    if (!pending) return
    setArmed(false)
    setError(null)
    setValues(schema ? initialValues(schema) : {})
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [pending, schema])

  if (!pending) return null

  const answer = async (action: 'accept' | 'decline' | 'cancel', content?: unknown) => {
    const requestId = pending.requestId
    remove(requestId)
    try {
      await invoke('resolve_mcp_elicitation', { requestId, action, content: content ?? null })
    } catch (e) {
      logger.error('[McpElicitationDialog] resolve_mcp_elicitation failed:', e)
    }
  }

  const submit = () => {
    if (!schema) return
    const built = buildContent(schema, values)
    if ('error' in built) {
      const property = schema.properties?.[built.error]
      setError(t('elicitation.invalidField', { field: property?.title ?? built.error }))
      return
    }
    void answer('accept', built.content)
  }

  const openLink = async () => {
    if (pending.mode !== 'url') return
    try {
      await openUrl(pending.url)
    } catch (e) {
      logger.error('[McpElicitationDialog] Could not open the link:', e)
    }
    void answer('accept')
  }

  const host = (() => {
    if (pending.mode !== 'url') return ''
    try {
      return new URL(pending.url).host
    } catch {
      return pending.url
    }
  })()

  return (
    <Dialog open onOpenChange={(open) => !open && answer('decline')}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="size-5 shrink-0" />
            {t('elicitation.title', { server: pending.serverName })}
          </DialogTitle>
          <DialogDescription className="text-left whitespace-pre-wrap">
            {pending.message}
          </DialogDescription>
        </DialogHeader>

        {pending.mode === 'form' && schema && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (armed) submit()
            }}
          >
            {Object.entries(schema.properties ?? {}).map(([name, property]) => (
              <Field
                key={name}
                name={name}
                property={property}
                required={(schema.required ?? []).includes(name)}
                value={values[name] ?? ''}
                disabled={!armed}
                onChange={(value) => setValues((prev) => ({ ...prev, [name]: value }))}
              />
            ))}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
        )}

        {pending.mode === 'url' && (
          <div className="grid gap-1.5 rounded-md bg-muted px-3 py-2 text-xs">
            <p className="font-medium">{t('elicitation.urlHost', { host })}</p>
            <p className="font-mono break-all text-muted-foreground">{pending.url}</p>
          </div>
        )}

        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {t('elicitation.queueCount', { count: queue.length - 1 })}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={!armed} onClick={() => answer('cancel')}>
            {t('elicitation.cancel')}
          </Button>
          <Button variant="outline" disabled={!armed} onClick={() => answer('decline')}>
            {t('elicitation.decline')}
          </Button>
          {pending.mode === 'form' ? (
            <Button disabled={!armed} onClick={submit}>
              {t('elicitation.submit')}
            </Button>
          ) : (
            <Button disabled={!armed} onClick={openLink}>
              <ExternalLink className="size-4" />
              {t('elicitation.openLink')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
