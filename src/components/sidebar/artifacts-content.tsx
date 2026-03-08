import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export function ArtifactsContent() {
  const { t } = useTranslation('sidebar')

  return (
    <div className="p-2">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Layers />
          </EmptyMedia>
          <EmptyTitle>{t('noArtifacts')}</EmptyTitle>
          <EmptyDescription>{t('artifactsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
