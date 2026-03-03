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

// Canonical display order for builtin tools
const BUILTIN_TOOL_ORDER: Record<string, number> = {
  [BUILTIN_WEB_FETCH_ID]: 0,
  [BUILTIN_WEB_SEARCH_ID]: 1,
  [BUILTIN_BASH_ID]: 2,
  [BUILTIN_READ_ID]: 3,
  [BUILTIN_EDIT_ID]: 4,
  [BUILTIN_WRITE_ID]: 5,
  [BUILTIN_GREP_ID]: 6,
  [BUILTIN_GLOB_ID]: 7,
}

export function sortBuiltinTools<T extends { id: string }>(tools: T[]): T[] {
  return [...tools].sort(
    (a, b) => (BUILTIN_TOOL_ORDER[a.id] ?? 99) - (BUILTIN_TOOL_ORDER[b.id] ?? 99)
  )
}

// Tool types
export interface Tool {
  id: string
  name: string
  type: string // "mcp", "builtin", "server", "tool", "api"
  endpoint?: string
  config?: string // JSON string of McpConfig
  description?: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

// Helper to check if a tool is a builtin tool
export function isBuiltinTool(tool: Tool): boolean {
  return tool.type === TOOL_TYPE_BUILTIN
}

// Helper to check if a tool is an MCP tool
export function isMcpTool(tool: Tool): boolean {
  return tool.type === TOOL_TYPE_MCP
}

export interface CreateToolRequest {
  name: string
  type: string
  endpoint?: string
  config?: string
  description?: string
  is_enabled?: boolean
}

// MCP transport types
export type McpTransportType = 'http' | 'stdio'

// MCP HTTP auth type (OAuth applies only to HTTP per MCP spec)
export type McpAuthType = 'none' | 'bearer' | 'oauth'

// OAuth metadata (populated after discovery/authorization)
export interface McpOAuthMetadata {
  authorization_server_url: string
  client_id?: string
  scopes?: string[]
  token_expires_at?: number
  is_authorized: boolean
}

// MCP server configuration for frontend
export interface McpServerConfig {
  transport: McpTransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  auth_type?: McpAuthType
  oauth_metadata?: McpOAuthMetadata
  headers?: Record<string, string>
}

// Result of probing an MCP endpoint for OAuth discovery
export interface ProbeResult {
  status: 'ok' | 'needs_oauth' | 'error'
  error?: string
  authorization_server_url?: string
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  scopes_supported?: string[]
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
