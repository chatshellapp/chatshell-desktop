// Renders a ```openui-lang fence as a static OpenUI block: a chart or KPI
// cards drawn with shadcn components, which take their colors from the app's
// CSS variables in light and dark mode. Nothing in a block acts: no
// `onAction`, state callbacks, or tool provider are passed to the renderer.
// Loaded lazily by `openui-block.tsx`, so Recharts loads on first use.
// Design: internal-docs/features/openui-blocks.md.

import { Component, useCallback, useState, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Code, LayoutTemplate } from 'lucide-react'
import { Renderer, type ParseResult } from '@openuidev/react-lang'

import { logger } from '@/lib/logger'
import { chatShellOpenUiLibrary } from '@/lib/openui/library'
import { CodeBlock } from './code-block'
import { useMarkdownStreaming } from './streaming-context'
import type { OpenUiBlockProps } from './types'

const actionButton =
  'flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors'

/**
 * Catches a render crash and shows `fallback`. A new `source` clears the
 * failure, so a program that crashed half-way through streaming gets another
 * try once more of it arrives.
 */
class RenderBoundary extends Component<
  { source: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { source: string }) {
    if (this.state.failed && prev.source !== this.props.source) {
      this.setState({ failed: false })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('OpenUI block failed to render:', {
      error: String(error),
      componentStack: info.componentStack,
    })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default function OpenUiBlockContent({ code, flat = false }: OpenUiBlockProps) {
  const { t } = useTranslation(['attachments'])
  const streaming = useMarkdownStreaming()
  const [showSource, setShowSource] = useState(false)
  const [hasRoot, setHasRoot] = useState(true)

  const onParseResult = useCallback((result: ParseResult | null) => {
    setHasRoot(Boolean(result?.root))
  }, [])

  const source = <CodeBlock language="openui-lang" code={code} flat={flat} />
  // A finished block with nothing renderable is shown as its source.
  const broken = !streaming && !hasRoot
  const failed = (
    <div className="my-2">
      <div className="flex items-center gap-1.5 px-1 pb-1 text-xs text-muted-foreground">
        <AlertTriangle className="size-3.5" />
        {t('openUiFailed')}
      </div>
      {source}
    </div>
  )

  if (broken) return failed

  return (
    <div className="my-2 group/openui">
      <div className="flex justify-end gap-1 pb-1 opacity-0 group-hover/openui:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          className={actionButton}
          onClick={() => setShowSource((value) => !value)}
          aria-pressed={showSource}
        >
          {showSource ? <LayoutTemplate className="size-3.5" /> : <Code className="size-3.5" />}
          {showSource ? t('openUiShowBlock') : t('openUiShowSource')}
        </button>
      </div>
      {showSource ? (
        source
      ) : (
        <RenderBoundary source={code} fallback={failed}>
          <Renderer
            response={code}
            library={chatShellOpenUiLibrary}
            isStreaming={streaming}
            onParseResult={onParseResult}
            publishObservability={false}
          />
        </RenderBoundary>
      )}
    </div>
  )
}
