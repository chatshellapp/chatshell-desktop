import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Copy, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ApiErrorPreviewProps {
  error: string
  onDismiss?: () => void
}

interface ParsedError {
  statusCode?: number
  statusText?: string
  summary: string
  providerMessage?: string
  providerErrorType?: string
  providerErrorCode?: string
  rawError: string
}

function getStatusLabel(status: number, t: (key: string) => string): string {
  const labels: Record<number, string> = {
    400: t('messages:apiErrorBadRequest'),
    401: t('messages:apiErrorUnauthorized'),
    403: t('messages:apiErrorForbidden'),
    404: t('messages:apiErrorNotFound'),
    408: t('messages:apiErrorTimeout'),
    413: t('messages:apiErrorPayloadTooLarge'),
    422: t('messages:apiErrorUnprocessable'),
    429: t('messages:apiErrorRateLimited'),
    500: t('messages:apiErrorServerError'),
    502: t('messages:apiErrorBadGateway'),
    503: t('messages:apiErrorServiceUnavailable'),
    504: t('messages:apiErrorGatewayTimeout'),
  }
  return labels[status] || `Error ${status}`
}

function parseApiError(error: string, t: (key: string) => string): ParsedError {
  const result: ParsedError = { summary: error, rawError: error }
  let remaining = error

  // Extract [HTTP xxx] prefix (from backend format_message)
  const httpBracketMatch = remaining.match(/^\[HTTP (\d{3})\]\s*/)
  if (httpBracketMatch) {
    result.statusCode = parseInt(httpBracketMatch[1], 10)
    result.statusText = getStatusLabel(result.statusCode, t)
    remaining = remaining.slice(httpBracketMatch[0].length)
  }

  // Extract [error_code] prefix (from backend format_message)
  if (!result.providerErrorCode) {
    const codeBracketMatch = remaining.match(/^\[([^\]]+)\]\s*/)
    if (codeBracketMatch) {
      result.providerErrorCode = codeBracketMatch[1]
      remaining = remaining.slice(codeBracketMatch[0].length)
    }
  }

  // Fallback: extract HTTP status from "HTTP 401 Unauthorized", "status code 429", etc.
  if (!result.statusCode) {
    const statusMatch = error.match(
      /(?:HTTP|status code)\s+(\d{3})(?:\s+([A-Za-z\s]+?))?(?:\s*[):,]|$)/i
    )
    if (statusMatch) {
      result.statusCode = parseInt(statusMatch[1], 10)
      result.statusText = statusMatch[2]?.trim() || getStatusLabel(result.statusCode, t)
    }
  }

  // Fallback: match rig's "Invalid status code 401 Unauthorized with message:" pattern
  if (!result.statusCode) {
    const rigStatusMatch = error.match(
      /Invalid status code (\d{3})\s+(\w[\w\s]*?)\s+with message:/i
    )
    if (rigStatusMatch) {
      result.statusCode = parseInt(rigStatusMatch[1], 10)
      result.statusText = rigStatusMatch[2]?.trim()
    }
  }

  // Try to find and parse embedded JSON error body
  const jsonMatch = remaining.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const errObj = parsed.error ?? parsed

      if (typeof errObj === 'object' && errObj !== null) {
        if (errObj.message) {
          result.providerMessage = errObj.message
          result.summary = errObj.message
        }
        if (errObj.type) result.providerErrorType = errObj.type
        if (errObj.code && !result.providerErrorCode) result.providerErrorCode = String(errObj.code)
      } else if (typeof errObj === 'string') {
        result.providerMessage = errObj
        result.summary = errObj
      }
    } catch {
      // JSON parse failed — not a JSON body, use original string
    }
  }

  // If we extracted [HTTP][code] prefixes, use the remaining text as the summary
  if (!result.providerMessage && remaining !== error) {
    result.summary = remaining.trim() || error
  }

  // If still no clean message, try to strip internal prefixes
  if (!result.providerMessage && remaining === error) {
    let cleaned = error
      .replace(/^Stream error:\s*/i, '')
      .replace(/^Provider error:\s*/i, '')
      .replace(/^Failed to create agent:\s*/i, '')
      .replace(/^CompletionError:\s*/i, '')
    cleaned = cleaned.replace(/^Invalid status code \d{3}\s+\w[\w\s]*?\s+with message:\s*/i, '')
    if (cleaned !== error) {
      result.summary = cleaned.trim() || error
    }
  }

  return result
}

function StatusBadge({
  code,
  text,
  t,
}: {
  code: number
  text?: string
  t: (key: string) => string
}) {
  const label = text || getStatusLabel(code, t)
  const colorClass =
    code >= 500
      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
      : code >= 400
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-medium ${colorClass}`}
    >
      {code}
      {label && <span className="ml-1 font-sans">{label}</span>}
    </span>
  )
}

export function ApiErrorPreview({ error, onDismiss }: ApiErrorPreviewProps) {
  const { t } = useTranslation()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const parsed = useMemo(() => parseApiError(error, t), [error, t])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(error)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        onClick={() => setIsDialogOpen(true)}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg border border-destructive/50 bg-destructive/5 text-left hover:border-destructive/70 transition-colors cursor-pointer"
      >
        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        <span className="flex-1 text-sm truncate">
          <span className="font-medium text-destructive">{t('messages:apiError')}</span>
          {parsed.statusCode && (
            <span className="ml-2">
              <StatusBadge code={parsed.statusCode} text={parsed.statusText} t={t} />
            </span>
          )}
          <span className="text-muted-foreground ml-2 truncate">{parsed.summary}</span>
        </span>
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              {t('messages:apiError')}
              {parsed.statusCode && (
                <StatusBadge code={parsed.statusCode} text={parsed.statusText} t={t} />
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Provider error message */}
            {parsed.providerMessage && (
              <div className="px-3 py-2.5 bg-destructive/10 rounded-md">
                <p className="text-sm text-destructive">{parsed.providerMessage}</p>
              </div>
            )}

            {/* Error type / code metadata */}
            {(parsed.providerErrorType || parsed.providerErrorCode) && (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {parsed.providerErrorType && (
                  <span className="px-2 py-0.5 bg-muted rounded font-mono">
                    type: {parsed.providerErrorType}
                  </span>
                )}
                {parsed.providerErrorCode && (
                  <span className="px-2 py-0.5 bg-muted rounded font-mono">
                    code: {parsed.providerErrorCode}
                  </span>
                )}
              </div>
            )}

            {/* Full raw error */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('attachments:fullError')}</p>
              <div className="px-3 py-2 bg-muted/50 rounded-md max-h-48 overflow-y-auto">
                <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">
                  {error}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('common:copied') : t('common:copy')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false)
                onDismiss?.()
              }}
            >
              {t('common:dismiss')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
