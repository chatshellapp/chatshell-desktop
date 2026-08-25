import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import type { CodeBlockProps } from './types'

export function CodeBlock({ language, code, flat = false }: CodeBlockProps) {
  const { t } = useTranslation(['common', 'attachments'])
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div
      className={
        flat
          ? 'relative group border border-border rounded-md overflow-hidden'
          : 'relative group my-2 border border-border rounded-md overflow-hidden'
      }
    >
      <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
        <span
          className={
            flat
              ? 'text-[10px] text-muted-foreground font-mono'
              : 'text-xs text-muted-foreground font-mono'
          }
        >
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 rounded transition-colors"
          aria-label={copied ? t('attachments:copied') : t('attachments:copyCode')}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span className="text-[10px]">{t('attachments:copied')}</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span className="text-[10px]">{t('attachments:copy')}</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneLight}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: flat ? '0.75rem' : '0.875rem',
          background: '#fafafa',
        }}
        showLineNumbers={code.split('\n').length > 3}
        lineNumberStyle={{ userSelect: 'none', MozUserSelect: 'none', WebkitUserSelect: 'none' }}
        wrapLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
