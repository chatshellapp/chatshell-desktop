import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Code,
  Copy,
  Download,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
} from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { logger } from '@/lib/logger'
import {
  peekPreparedSvg,
  prepareSvgFigure,
  svgDataUrl,
  usePrefersReducedMotion,
  useSvgPalette,
  type PreparedSvg,
  type SvgFigureError,
} from '@/lib/svg-figure'
import { CodeBlock } from './code-block'
import { useMarkdownStreaming } from './streaming-context'
import type { SvgFigureBlockProps } from './types'

/** Least time between preparations while the fence streams. */
export const SVG_STREAM_DEBOUNCE_MS = 200
/** Share of the viewport height one figure may fill. */
const MAX_VIEWPORT_HEIGHT = '70vh'
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4]

/** The `<title>` text, for the image's accessible name. */
function figureTitle(source: string): string | null {
  const match = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(source)
  return match ? match[1].trim() || null : null
}

const actionButton =
  'flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors'

export function SvgFigureBlock({ code, flat = false }: SvgFigureBlockProps) {
  const { t } = useTranslation(['attachments'])
  const streaming = useMarkdownStreaming()
  const palette = useSvgPalette()
  const reducedMotion = usePrefersReducedMotion()
  const [paused, setPaused] = useState(false)
  const stripAnimation = reducedMotion || paused
  const options = useMemo(() => ({ streaming, stripAnimation }), [streaming, stripAnimation])

  // Last figure that prepared, kept on screen while newer revisions prepare.
  const [figure, setFigure] = useState<PreparedSvg | null>(() => {
    const cached = peekPreparedSvg(code, palette, options)
    return cached?.ok ? cached.value : null
  })
  const [failure, setFailure] = useState<SvgFigureError | null>(() => {
    const cached = peekPreparedSvg(code, palette, options)
    return cached && !cached.ok ? cached.error : null
  })
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const entry = await prepareSvgFigure(code, palette, options)
      if (cancelled) return
      if (entry.ok) {
        setFigure(entry.value)
        setFailure(null)
      } else if (!streaming) {
        // Final source that does not render falls back to code.
        setFigure(null)
        setFailure(entry.error)
      }
      // While streaming, a failed revision keeps the previous figure.
    }
    const delay = streaming ? SVG_STREAM_DEBOUNCE_MS : 0
    const timer = setTimeout(() => void run(), delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, palette, options, streaming])

  const dataUrl = useMemo(() => (figure ? svgDataUrl(figure.svg) : null), [figure])
  const title = useMemo(() => figureTitle(code), [code])
  const alt = title ?? t('attachments:svgFigureAlt')

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  const handleDownload = useCallback(async () => {
    try {
      const filePath = await save({
        defaultPath: 'figure.svg',
        filters: [{ name: 'SVG Image', extensions: ['svg'] }],
      })
      if (filePath) await writeTextFile(filePath, code)
    } catch (err) {
      logger.error('Failed to save SVG figure:', err)
    }
  }, [code])

  const zoomBy = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      const at = ZOOM_STEPS.indexOf(current)
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + direction))]
      return next ?? 1
    })
  }, [])

  const container = flat
    ? 'border border-border rounded-md overflow-hidden'
    : 'my-2 border border-border rounded-md overflow-hidden'

  if (failure && !streaming) {
    return (
      <div className={flat ? '' : 'my-2'} data-testid="svg-figure-fallback">
        <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          <span>{t('attachments:svgFigureFailed')}</span>
        </div>
        <CodeBlock language="svg" code={code} flat={flat} />
      </div>
    )
  }

  if (showSource) {
    return (
      <div className={flat ? '' : 'my-2'}>
        <div className="flex justify-end pb-1">
          <button
            type="button"
            onClick={() => setShowSource(false)}
            className={actionButton}
            aria-label={t('attachments:svgShowFigure')}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>{t('attachments:svgShowFigure')}</span>
          </button>
        </div>
        <CodeBlock language="svg" code={code} flat={flat} />
      </div>
    )
  }

  return (
    <div className={container} data-testid="svg-figure">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">svg</span>
          {streaming && figure && (
            <span className="text-xs text-muted-foreground/60 italic">
              {t('attachments:updating')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {figure?.animated && !reducedMotion && (
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className={actionButton}
              aria-label={paused ? t('attachments:svgPlay') : t('attachments:svgPause')}
              title={paused ? t('attachments:svgPlay') : t('attachments:svgPause')}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSource(true)}
            className={actionButton}
            aria-label={t('attachments:svgShowSource')}
            title={t('attachments:svgShowSource')}
          >
            <Code className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className={actionButton}
            aria-label={copied ? t('attachments:copied') : t('attachments:copyCode')}
            title={t('attachments:copyCode')}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className={actionButton}
            aria-label={t('attachments:downloadSvg')}
            title={t('attachments:downloadSvg')}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {figure && (
            <button
              type="button"
              onClick={() => {
                setZoom(1)
                setViewerOpen(true)
              }}
              className={actionButton}
              aria-label={t('attachments:svgOpenViewer')}
              title={t('attachments:svgOpenViewer')}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {figure && dataUrl ? (
        <div className="p-3 flex justify-center overflow-hidden">
          <img
            src={dataUrl}
            alt={alt}
            width={figure.width}
            draggable={false}
            onClick={() => {
              setZoom(1)
              setViewerOpen(true)
            }}
            className="block h-auto max-w-full cursor-zoom-in select-none object-contain"
            style={{
              aspectRatio: `${figure.width} / ${figure.height}`,
              maxHeight: MAX_VIEWPORT_HEIGHT,
            }}
          />
        </div>
      ) : (
        <div className="p-4 flex items-center justify-center bg-muted/30">
          <span className="text-sm text-muted-foreground">{t('attachments:svgDrawing')}</span>
        </div>
      )}

      {figure && dataUrl && (
        <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
          <DialogContent className="sm:max-w-[92vw] w-[92vw] h-[88vh] grid-rows-[auto_1fr] p-4">
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-sm font-medium">{alt}</DialogTitle>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => zoomBy(-1)}
                  className={actionButton}
                  aria-label={t('attachments:svgZoomOut')}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => zoomBy(1)}
                  className={actionButton}
                  aria-label={t('attachments:svgZoomIn')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="overflow-auto flex min-h-0">
              <img
                src={dataUrl}
                alt={alt}
                draggable={false}
                className="m-auto block max-w-none select-none"
                style={{
                  width: `calc(min(100%, ${figure.width * 2}px) * ${zoom})`,
                  aspectRatio: `${figure.width} / ${figure.height}`,
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
