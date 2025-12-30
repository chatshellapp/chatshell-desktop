// Tool types
export interface Tool {
  id: string
  name: string
  type: string // "server", "tool", "api", "mcp"
  endpoint?: string
  config?: string // JSON string of McpConfig
  description?: string
  is_enabled: boolean
  created_at: string
  updated_at: string
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
