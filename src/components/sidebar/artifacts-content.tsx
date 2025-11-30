import { ChevronRight, Code, FileText, BarChart3, Component, Star } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { Artifact, ArtifactGroup } from '@/lib/sidebar-data'

interface ArtifactsContentProps {
  artifactGroups: ArtifactGroup[]
  selectedArtifactId?: string
  onArtifactClick: (artifact: Artifact) => void
  onArtifactStarToggle: (artifact: Artifact) => void
}

function getArtifactIcon(type: Artifact['type']) {
  switch (type) {
    case 'code':
      return <Code className="size-4 text-blue-500" />
    case 'document':
      return <FileText className="size-4 text-green-500" />
    case 'chart':
      return <BarChart3 className="size-4 text-purple-500" />
    case 'component':
      return <Component className="size-4 text-orange-500" />
    case 'image':
      return <FileText className="size-4 text-pink-500" />
    default:
      return <FileText className="size-4 text-muted-foreground" />
  }
}

function getLanguageBadge(language?: string) {
  if (!language) return null

  const colors: Record<string, string> = {
    tsx: 'bg-blue-500/10 text-blue-500',
    typescript: 'bg-blue-500/10 text-blue-500',
    javascript: 'bg-yellow-500/10 text-yellow-500',
    python: 'bg-green-500/10 text-green-500',
    sql: 'bg-orange-500/10 text-orange-500',
    rust: 'bg-red-500/10 text-red-500',
  }

  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded',
        colors[language] || 'bg-muted text-muted-foreground'
      )}
    >
      {language}
    </span>
  )
}

export function ArtifactsContent({
  artifactGroups,
  selectedArtifactId,
  onArtifactClick,
  onArtifactStarToggle,
}: ArtifactsContentProps) {
  return (
    <div className="p-2">
      {artifactGroups.map((group) => (
        <Collapsible key={group.id} defaultOpen={group.defaultOpen} className="mb-2">
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&[data-state=open]>svg]:rotate-90">
            <ChevronRight className="size-4 transition-transform" />
            <span>{group.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{group.artifacts.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 space-y-1 pl-2">
            {group.artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onArtifactClick(artifact)}
                className={cn(
                  'w-full flex flex-col items-start gap-1 rounded-md border p-3 text-left text-sm transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  selectedArtifactId === artifact.id &&
                    'bg-sidebar-accent text-sidebar-accent-foreground border-primary/50'
                )}
              >
                <div className="flex w-full items-center gap-2">
                  {getArtifactIcon(artifact.type)}
                  <span className="font-medium truncate flex-1">{artifact.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onArtifactStarToggle(artifact)
                    }}
                    className="hover:text-yellow-500 transition-colors"
                  >
                    <Star
                      className={cn(
                        'size-3.5',
                        artifact.isStarred
                          ? 'fill-yellow-500 text-yellow-500'
                          : 'text-muted-foreground'
                      )}
                    />
                  </button>
                </div>
                {artifact.preview && (
                  <p className="text-xs text-muted-foreground line-clamp-2 w-full">
                    {artifact.preview}
                  </p>
                )}
                <div className="flex w-full items-center gap-2 text-xs text-muted-foreground mt-1">
                  {getLanguageBadge(artifact.language)}
                  <span className="ml-auto">{artifact.createdAt}</span>
                </div>
              </button>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}
