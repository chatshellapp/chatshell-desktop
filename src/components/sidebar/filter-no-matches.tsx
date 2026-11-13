import { useTranslation } from 'react-i18next'

/** Shown instead of a list when the sidebar filter matches nothing */
export function FilterNoMatches() {
  const { t } = useTranslation('sidebar')
  return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('noMatches')}</p>
}
