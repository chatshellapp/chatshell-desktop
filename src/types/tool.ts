// Tool types are generated from Rust models (src-tauri/src/models/tool.rs)
// via ts-rs. Run `pnpm types:generate` in src-tauri to regenerate.

export type { Tool } from './generated/Tool'
export type { CreateToolRequest } from './generated/CreateToolRequest'
export type { McpTransportType } from './generated/McpTransportType'
export type { McpAuthType } from './generated/McpAuthType'
export type { ProbeResult } from './generated/ProbeResult'
export type { McpConfig as McpServerConfig } from './generated/McpConfig'
export type { OAuthMetadata as McpOAuthMetadata } from './generated/OAuthMetadata'

import type { Tool } from './generated/Tool'
import type { McpTransportType } from './generated/McpTransportType'
import type { McpConfig as McpServerConfig } from './generated/McpConfig'

// Tool type constants
export const TOOL_TYPE_MCP = 'mcp'
export const TOOL_TYPE_BUILTIN = 'builtin'

// Builtin tool IDs (must match backend constants)
export const BUILTIN_WEB_FETCH_ID = 'builtin-web-fetch'
export const BUILTIN_WEB_SEARCH_ID = 'builtin-web-search'
export const BUILTIN_BASH_ID = 'builtin-bash'
export const BUILTIN_READ_ID = 'builtin-read'
export const BUILTIN_EDIT_ID = 'builtin-edit'
export const BUILTIN_WRITE_ID = 'builtin-write'
export const BUILTIN_GREP_ID = 'builtin-grep'
export const BUILTIN_GLOB_ID = 'builtin-glob'
export const BUILTIN_KILL_SHELL_ID = 'builtin-kill-shell'

// Canonical display order for builtin tools
const BUILTIN_TOOL_ORDER: Record<string, number> = {
  [BUILTIN_WEB_FETCH_ID]: 0,
  [BUILTIN_WEB_SEARCH_ID]: 1,
  [BUILTIN_BASH_ID]: 2,
  [BUILTIN_KILL_SHELL_ID]: 3,
  [BUILTIN_READ_ID]: 4,
  [BUILTIN_EDIT_ID]: 5,
  [BUILTIN_WRITE_ID]: 6,
  [BUILTIN_GREP_ID]: 7,
  [BUILTIN_GLOB_ID]: 8,
}

export function sortBuiltinTools<T extends { id: string }>(tools: T[]): T[] {
  return [...tools].sort(
    (a, b) => (BUILTIN_TOOL_ORDER[a.id] ?? 99) - (BUILTIN_TOOL_ORDER[b.id] ?? 99)
  )
}

// Helper to check if a tool is a builtin tool
export function isBuiltinTool(tool: Tool): boolean {
  return tool.type === TOOL_TYPE_BUILTIN
}

// Helper to check if a tool is an MCP tool
export function isMcpTool(tool: Tool): boolean {
  return tool.type === TOOL_TYPE_MCP
}

// Helper to parse Tool.config as McpServerConfig
export function parseMcpConfig(configStr?: string): McpServerConfig | null {
  if (!configStr) return null
  try {
    return JSON.parse(configStr) as McpServerConfig
  } catch {
    return null
  }
}

// Helper to get transport type from Tool
export function getTransportType(tool: Tool): McpTransportType {
  const config = parseMcpConfig(tool.config)
  return config?.transport ?? 'http'
}
