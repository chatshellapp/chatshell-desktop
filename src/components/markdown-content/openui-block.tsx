import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import type { OpenUiBlockProps } from './types'

// The renderer, component library, and its stylesheet load on first use, so
// conversations without OpenUI blocks never pay for them.
const OpenUiBlockContent = lazy(() => import('./openui-block-content'))

export function OpenUiBlock(props: OpenUiBlockProps) {
  const { t } = useTranslation(['attachments'])
  return (
    <Suspense
      fallback={
        <div className="my-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          {t('openUiLoading')}
        </div>
      }
    >
      <OpenUiBlockContent {...props} />
    </Suspense>
  )
}
