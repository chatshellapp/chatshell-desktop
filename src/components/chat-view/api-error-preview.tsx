import { useMemo, useState } from 'react'
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

function parseApiError(error: string): ParsedError {
  const result: ParsedError = { summary: error, rawError: error }

  // Extract HTTP status code: "HTTP 401 Unauthorized", "status code 429 Too Many Requests", etc.
  const statusMatch = error.match(/(?:HTTP|status code)\s+(\d{3})(?:\s+([A-Za-z\s]+?))?(?:\s*[):,]|$)/i)
  if (statusMatch) {
    result.statusCode = parseInt(statusMatch[1], 10)
    result.statusText = statusMatch[2]?.trim()
  }

  // Also match rig's "Invalid status code 401 Unauthorized with message:" pattern
  const rigStatusMatch = error.match(/Invalid status code (\d{3})\s+(\w[\w\s]*?)\s+with message:/i)
  if (rigStatusMatch && !result.statusCode) {
    result.statusCode = parseInt(rigStatusMatch[1], 10)
    result.statusText = rigStatusMatch[2]?.trim()
  }

  // Try to find and parse embedded JSON error body
  const jsonMatch = error.match(/\{[\s\S]*\}/)
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
        if (errObj.code) result.providerErrorCode = String(errObj.code)
      } else if (typeof errObj === 'string') {
        result.providerMessage = errObj
        result.summary = errObj
      }
    } catch {
      // JSON parse failed — not a JSON body, use original string
    }
  }

  // If no JSON was found, try to extract a readable message from the error string
  if (!result.providerMessage) {
    // Remove common prefixes to get a cleaner summary
    let cleaned = error
      .replace(/^Stream error:\s*/i, '')
      .replace(/^Provider error:\s*/i, '')
      .replace(/^Failed to create agent:\s*/i, '')
      .replace(/^CompletionError:\s*/i, '')
    // Remove "Invalid status code XXX ... with message:" prefix
    cleaned = cleaned.replace(/^Invalid status code \d{3}\s+\w[\w\s]*?\s+with message:\s*/i, '')
    if (cleaned !== error) {
      result.summary = cleaned.trim() || error
    }
  }

  return result
}

function StatusBadge({ code, text }: { code: number; text?: string }) {
  const colorClass =
    code >= 500
      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
      : code >= 400
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-medium ${colorClass}`}>
      {code}
      {text && <span className="ml-1 font-sans">{text}</span>}
    </span>
  )
}

export function ApiErrorPreview({ error, onDismiss }: ApiErrorPreviewProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const parsed = useMemo(() => parseApiError(error), [error])

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
          <span className="font-medium text-destructive">API Error</span>
          {parsed.statusCode && (
            <span className="ml-2">
              <StatusBadge code={parsed.statusCode} text={parsed.statusText} />
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
              API Error
              {parsed.statusCode && (
                <StatusBadge code={parsed.statusCode} text={parsed.statusText} />
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
              <p className="text-xs text-muted-foreground mb-1">Full error</p>
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
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false)
                onDismiss?.()
              }}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
