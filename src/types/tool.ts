// Tool type constants
export const TOOL_TYPE_MCP = 'mcp'
export const TOOL_TYPE_BUILTIN = 'builtin'

// Builtin tool IDs (must match backend constants)
export const BUILTIN_WEB_SEARCH_ID = 'builtin-web-search'
export const BUILTIN_WEB_FETCH_ID = 'builtin-web-fetch'
export const BUILTIN_BASH_ID = 'builtin-bash'
export const BUILTIN_READ_ID = 'builtin-read'
export const BUILTIN_GREP_ID = 'builtin-grep'
export const BUILTIN_GLOB_ID = 'builtin-glob'

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

// MCP server configuration for frontend
export interface McpServerConfig {
  transport: McpTransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
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
