import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Braces,
  FileSearch,
  FilePlus2,
  FolderSearch,
  Globe,
  Pencil,
  FileText,
  Power,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import {
  BUILTIN_BASH_ID,
  BUILTIN_EDIT_ID,
  BUILTIN_GLOB_ID,
  BUILTIN_GREP_ID,
  BUILTIN_KILL_SHELL_ID,
  BUILTIN_READ_ID,
  BUILTIN_WEB_FETCH_ID,
  BUILTIN_WEB_SEARCH_ID,
  BUILTIN_WRITE_ID,
} from '@/types/tool'

const BUILTIN_TOOL_ICONS: Record<string, LucideIcon> = {
  [BUILTIN_WEB_SEARCH_ID]: Search,
  [BUILTIN_WEB_FETCH_ID]: Globe,
  [BUILTIN_BASH_ID]: Terminal,
  [BUILTIN_KILL_SHELL_ID]: Power,
  [BUILTIN_READ_ID]: FileText,
  [BUILTIN_EDIT_ID]: Pencil,
  [BUILTIN_WRITE_ID]: FilePlus2,
  [BUILTIN_GREP_ID]: FileSearch,
  [BUILTIN_GLOB_ID]: FolderSearch,
}

const TOOL_NAME_ICONS: Record<string, LucideIcon> = {
  web_search: Search,
  web_fetch: Globe,
  bash: Terminal,
  kill_shell: Power,
  read: FileText,
  edit: Pencil,
  write: FilePlus2,
  grep: FileSearch,
  glob: FolderSearch,
  load_skill: BookOpen,
  load_mcp_schema: Braces,
}

export function getBuiltinToolIcon(toolId: string): LucideIcon {
  return BUILTIN_TOOL_ICONS[toolId] ?? Wrench
}

export function getToolIconByName(toolName: string): LucideIcon {
  return TOOL_NAME_ICONS[toolName] ?? Wrench
}

interface BuiltinToolIconProps {
  toolId: string
  className?: string
}

export function BuiltinToolIcon({ toolId, className = 'h-5 w-5' }: BuiltinToolIconProps) {
  const Icon = getBuiltinToolIcon(toolId)
  return <Icon className={className} />
}
