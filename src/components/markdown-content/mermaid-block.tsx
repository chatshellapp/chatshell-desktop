import { useState, useCallback, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, AlertTriangle, Download } from 'lucide-react'
import mermaid from 'mermaid'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { MermaidBlockProps } from './types'
import { logger } from '@/lib/logger'
import { mermaidThemeVariables, readDiagramBackground } from '@/lib/mermaid-theme'
import { paletteKey, useSvgPalette, type SvgPalette } from '@/lib/svg-figure'

// Mermaid's config is global; it is re-initialized whenever the app theme
// (and so the palette) changes, and every block re-renders with it.
let initializedThemeKey: string | null = null

function initializeMermaid(palette: SvgPalette) {
  const background = readDiagramBackground(palette.isDark)
  const themeKey = `${paletteKey(palette)}|${background}`
  if (initializedThemeKey === themeKey) return
  mermaid.initialize({
    startOnLoad: false,
    // `base` is the only theme Mermaid lets callers recolor; the variables
    // come from the app's visual palette (see mermaid-theme.ts).
    theme: 'base',
    themeVariables: mermaidThemeVariables(palette, background),
    // `strict`: labels are HTML-escaped and click callbacks are disabled; the
    // diagram source comes from model output, so it is untrusted.
    securityLevel: 'strict',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    // Enable all diagram types explicitly
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true },
    mindmap: { useMaxWidth: true, padding: 10 },
  })
  initializedThemeKey = themeKey
}

// Clean up any orphaned mermaid error elements from failed renders
function cleanupMermaidElements(elementId: string) {
  // Mermaid creates elements with id like 'd${id}' for the diagram
  const possibleIds = [elementId, `d${elementId}`, `${elementId}-svg`]
  possibleIds.forEach((id) => {
    const element = document.getElementById(id)
    if (element) {
      element.remove()
    }
  })
  // Also clean up any orphaned mermaid error containers
  document.querySelectorAll('[id^="mermaid-"][id$="-svg"]').forEach((el) => {
    if (!el.closest('.mermaid-container')) {
      el.remove()
    }
  })
}

// Debounce delay for mermaid rendering during streaming
const MERMAID_RENDER_DEBOUNCE_MS = 300

export function MermaidBlock({ code, flat = false }: MermaidBlockProps) {
  const { t } = useTranslation(['common', 'attachments'])
  const uniqueId = useId()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renderKey, setRenderKey] = useState(0)
  const [copied, setCopied] = useState(false)
  const [isWaiting, setIsWaiting] = useState(true) // Start in waiting state
  const palette = useSvgPalette()
  const themeKey = paletteKey(palette)

  useEffect(() => {
    let cancelled = false

    // Show waiting state immediately when code changes
    setIsWaiting(true)

    const renderDiagram = async () => {
      // Generate a valid DOM id from useId (remove colons) with render key for uniqueness
      const elementId = `mermaid-${uniqueId.replace(/:/g, '-')}-${renderKey}-${Date.now()}`

      try {
        // Ensure mermaid is initialized with the current theme before rendering
        initializeMermaid(palette)

        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        if (!cancelled) {
          setSvg(renderedSvg)
          setError(null)
          setIsWaiting(false)
        }
      } catch (err) {
        // Clean up any leftover DOM elements from failed render
        cleanupMermaidElements(elementId)

        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
          setError(errorMessage)
          // Don't clear svg - keep showing last successful render if any
          setIsWaiting(false)
        }
      }
    }

    // Debounce rendering to avoid flickering during streaming
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        renderDiagram()
      }
    }, MERMAID_RENDER_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
    // themeKey stands for palette: re-render when the app theme changes.
  }, [code, uniqueId, renderKey, themeKey])

  // Retry handler for error state
  const handleRetry = useCallback(() => {
    setError(null)
    setSvg(null)
    setRenderKey((k) => k + 1)
  }, [])

  // Copy source code to clipboard
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  // Download SVG as file using Tauri dialog
  const handleDownload = useCallback(async () => {
    if (!svg) return
    try {
      const filePath = await save({
        defaultPath: 'mermaid-diagram.svg',
        filters: [{ name: 'SVG Image', extensions: ['svg'] }],
      })
      if (filePath) {
        await writeTextFile(filePath, svg)
      }
    } catch (err) {
      logger.error('Failed to save diagram:', err)
    }
  }, [svg])

  // Show error only when not waiting and no successful render exists
  if (error && !isWaiting && !svg) {
    return (
      <div className="my-2 border border-amber-500/50 rounded-md overflow-hidden isolate">
        <div className="flex items-center justify-between px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-xs text-amber-700 font-medium">
              {t('attachments:failedToRenderDiagram')}
            </span>
          </div>
          <button
            onClick={handleRetry}
            className="text-xs text-amber-700 hover:text-amber-900 hover:underline"
          >
            {t('retry')}
          </button>
        </div>
        <div className="p-3 bg-amber-50/50">
          <pre className="text-xs text-amber-800 whitespace-pre-wrap font-mono break-words max-h-20 overflow-y-auto">
            {error}
          </pre>
          <details className="mt-2">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              {t('attachments:showSourceCode')}
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto">
              {code}
            </pre>
          </details>
        </div>
      </div>
    )
  }

  // Show loading state only when waiting and no previous render exists
  if (isWaiting && !svg) {
    return (
      <div className="my-2 border border-border rounded-md p-4 flex items-center justify-center bg-muted/30">
        <span className="text-sm text-muted-foreground">{t('attachments:renderingDiagram')}</span>
      </div>
    )
  }

  // No SVG and not in any special state - shouldn't normally happen
  if (!svg) {
    return (
      <div className="my-2 border border-border rounded-md p-4 flex items-center justify-center bg-muted/30">
        <span className="text-sm text-muted-foreground">
          {t('attachments:waitingForDiagramCode')}
        </span>
      </div>
    )
  }

  return (
    <div
      className={
        flat
          ? 'border border-border rounded-md overflow-hidden mermaid-container'
          : 'my-2 border border-border rounded-md overflow-hidden mermaid-container'
      }
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">mermaid</span>
          {isWaiting && (
            <span className="text-xs text-muted-foreground/60 italic">
              {t('attachments:updating')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors"
            aria-label={copied ? t('attachments:copied') : t('attachments:copyCode')}
            title={t('attachments:copyCode')}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>{t('attachments:copied')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>{t('attachments:copy')}</span>
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors"
            aria-label={t('attachments:downloadSvg')}
            title={t('attachments:downloadSvg')}
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('attachments:download')}</span>
          </button>
        </div>
      </div>
      <div
        className="p-4 bg-card flex justify-center overflow-x-auto [&>svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}
