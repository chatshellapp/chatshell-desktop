import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { ArrowUpRight } from 'lucide-react'
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
      className="w-fit text-left font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </button>
  )
}

// Release notes are the version's CHANGELOG.md section, delivered through the
// updater feed. The feed itself is not signed (only the packages are), so
// raw HTML is dropped and only http(s) links are followed.
const heading = ({ children }: { children?: ReactNode }) => (
  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground [&:not(:first-child)]:mt-3">
    {children}
  </h4>
)

const components: Components = {
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => (
    <ul className="grid list-disc gap-1.5 pl-4 marker:text-muted-foreground/60">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="grid list-decimal gap-1.5 pl-4 marker:text-muted-foreground/60">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
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
    <div className="grid gap-2">
      {notes?.trim() && (
        <div
          data-testid="release-notes"
          className="grid max-h-64 gap-2 overflow-auto rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground/85"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
            {notes}
          </ReactMarkdown>
        </div>
      )}
      <span className="text-xs">
        <ExternalLink href={`${CHANGELOG_URL}#v${version}`}>
          <span className="inline-flex items-center gap-0.5">
            {t('updateChangelogLink')}
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </ExternalLink>
      </span>
    </div>
  )
}
