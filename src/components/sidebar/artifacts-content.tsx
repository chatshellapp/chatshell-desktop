import { Layers } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export function ArtifactsContent() {
  return (
    <div className="p-2">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Layers />
          </EmptyMedia>
          <EmptyTitle>No Artifacts Yet</EmptyTitle>
          <EmptyDescription>
            Artifacts generated during conversations will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
