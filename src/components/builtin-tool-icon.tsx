import type { LucideIcon } from 'lucide-react'
import {
  FileSearch,
  FolderSearch,
  Globe,
  Pencil,
  FileText,
  FilePen,
  Search,
  TerminalSquare,
  Wrench,
} from 'lucide-react'
import {
  BUILTIN_BASH_ID,
  BUILTIN_EDIT_ID,
  BUILTIN_GLOB_ID,
  BUILTIN_GREP_ID,
  BUILTIN_READ_ID,
  BUILTIN_WEB_FETCH_ID,
  BUILTIN_WEB_SEARCH_ID,
  BUILTIN_WRITE_ID,
} from '@/types/tool'

const BUILTIN_TOOL_ICONS: Record<string, LucideIcon> = {
  [BUILTIN_WEB_SEARCH_ID]: Search,
  [BUILTIN_WEB_FETCH_ID]: Globe,
  [BUILTIN_BASH_ID]: TerminalSquare,
  [BUILTIN_READ_ID]: FileText,
  [BUILTIN_EDIT_ID]: Pencil,
  [BUILTIN_WRITE_ID]: FilePen,
  [BUILTIN_GREP_ID]: FileSearch,
  [BUILTIN_GLOB_ID]: FolderSearch,
}

export function getBuiltinToolIcon(toolId: string): LucideIcon {
  return BUILTIN_TOOL_ICONS[toolId] ?? Wrench
}

interface BuiltinToolIconProps {
  toolId: string
  className?: string
}

export function BuiltinToolIcon({ toolId, className = 'h-5 w-5' }: BuiltinToolIconProps) {
  const Icon = getBuiltinToolIcon(toolId)
  return <Icon className={className} />
}
