import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

export const CHANGELOG_URL = 'https://chatshell.app/changelog/'

async function openExternal(url: string) {
  try {
    await openUrl(url)
  } catch (error) {
    logger.error('Failed to open URL:', error)
    toast.error(String(error))
  }
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(href)}
      className="w-fit text-left font-medium text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </button>
  )
}

// Release notes are the version's CHANGELOG.md section, delivered through the
// updater feed. The feed itself is not signed (only the packages are), so
// raw HTML is dropped and only http(s) links are followed.
const components: Components = {
  h1: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h2: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  h3: ({ children }) => <p className="font-medium text-foreground">{children}</p>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="grid list-disc gap-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="grid list-decimal gap-0.5 pl-4">{children}</ol>,
  code: ({ children }) => <code className="rounded bg-muted px-1 font-mono">{children}</code>,
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <ExternalLink href={href}>{children}</ExternalLink>
    ) : (
      <>{children}</>
    ),
  img: () => null,
}

interface ReleaseNotesProps {
  version: string
  notes?: string
}

/** What's new in an available update, with a link to the full changelog. */
export function ReleaseNotes({ version, notes }: ReleaseNotesProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="grid gap-2 text-xs text-muted-foreground">
      {notes?.trim() && (
        <div
          data-testid="release-notes"
          className="grid max-h-56 gap-2 overflow-auto rounded-md bg-muted/50 p-3"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
            {notes}
          </ReactMarkdown>
        </div>
      )}
      <ExternalLink href={`${CHANGELOG_URL}#v${version}`}>{t('updateChangelogLink')}</ExternalLink>
    </div>
  )
}
