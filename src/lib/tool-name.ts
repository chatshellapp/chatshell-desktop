export interface ParsedToolName {
  type: 'builtin' | 'mcp'
  serverName?: string
  toolName: string
}

const MCP_PREFIX_RE = /^mcp__(.+?)__(.+)$/

export function parseToolName(raw: string): ParsedToolName {
  const match = raw.match(MCP_PREFIX_RE)
  if (match) {
    return { type: 'mcp', serverName: match[1], toolName: match[2] }
  }
  return { type: 'builtin', toolName: raw }
}
