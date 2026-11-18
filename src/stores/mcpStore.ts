import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { Tool, McpServerConfig, ProbeResult } from '@/types'
import { isMcpTool, getTransportType } from '@/types'
import { logger } from '@/lib/logger'

export interface OAuthStatusResult {
  is_authorized: boolean
  token_expires_at: number | null
}

// MCP tool info returned from server
export interface McpToolInfo {
  name: string
  description?: string
}

/** Latest server progress for an in-flight MCP tool call. */
export interface McpToolProgress {
  progress: number
  total?: number | null
  message?: string | null
}

export type McpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'needs_auth'

interface McpState {
  // MCP servers (stored as Tool with type='mcp')
  servers: Tool[]
  isLoading: boolean
  error: string | null

  // Connection testing state
  testingEndpoint: string | null
  testResult: McpToolInfo[] | null
  testError: string | null

  // Per-server connection status and tools
  connectionStatus: Record<string, McpConnectionStatus>
  serverTools: Record<string, McpToolInfo[]>
  connectionErrors: Record<string, string>

  // Per-server probe/discovery state
  probeResults: Record<string, ProbeResult>

  // Servers whose credentials were rejected (after any silent refresh).
  // Kept apart from connectionStatus so a reconnect in progress does not
  // hide the sign-in prompt; cleared by a successful connect.
  needsAuth: Record<string, boolean>
  // conversationId -> server ids the backend reported as needing sign-in
  // during that conversation (drives the in-chat banner; dismissing removes
  // the entry until the next report)
  authReports: Record<string, string[]>
  // conversationId -> tool-call display name -> latest progress
  toolProgress: Record<string, Record<string, McpToolProgress>>

  // Actions
  loadServers: () => Promise<void>
  ensureLoaded: () => Promise<void>
  createServer: (
    name: string,
    endpoint?: string,
    description?: string,
    config?: McpServerConfig
  ) => Promise<Tool>
  updateServer: (
    id: string,
    name: string,
    endpoint?: string,
    description?: string,
    config?: McpServerConfig,
    isEnabled?: boolean
  ) => Promise<Tool>
  deleteServer: (id: string) => Promise<void>
  toggleServer: (id: string) => Promise<Tool>
  setAllEnabled: (toolType: string, enabled: boolean) => Promise<void>
  testHttpConnection: (endpoint: string) => Promise<McpToolInfo[]>
  testStdioConnection: (config: McpServerConfig) => Promise<McpToolInfo[]>
  listServerTools: (id: string) => Promise<McpToolInfo[]>
  getServerById: (id: string) => Tool | undefined
  clearTestResult: () => void
  connectServer: (id: string) => Promise<void>
  probeEndpoint: (id: string) => Promise<ProbeResult>
  getConnectionStatus: (id: string) => McpConnectionStatus
  getServerToolsCached: (id: string) => McpToolInfo[]

  // OAuth and Bearer auth (HTTP transport only)
  startOAuth: (serverId: string) => Promise<Tool>
  checkOAuthStatus: (serverId: string) => Promise<OAuthStatusResult>
  revokeOAuth: (serverId: string) => Promise<void>
  setBearerToken: (serverId: string, token: string) => Promise<void>

  // Needs-auth surfacing (in-chat banner)
  reportNeedsAuth: (conversationId: string, serverId: string) => void
  markServersConnected: (serverIds: string[]) => void
  clearAuthReport: (conversationId: string, serverId: string) => void
  reauthorize: (serverId: string) => Promise<void>
  recheckNeedsAuth: () => Promise<void>

  // Live MCP updates
  setToolProgress: (conversationId: string, toolName: string, progress: McpToolProgress) => void
  clearToolProgress: (conversationId: string, toolName: string) => void
  refreshServerTools: (id: string) => Promise<void>
}

export const useMcpStore = create<McpState>()(
  immer((set, get) => ({
    servers: [],
    isLoading: false,
    error: null,
    testingEndpoint: null,
    testResult: null,
    testError: null,
    connectionStatus: {},
    serverTools: {},
    connectionErrors: {},
    probeResults: {},
    needsAuth: {},
    authReports: {},
    toolProgress: {},

    loadServers: async () => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const servers = await invoke<Tool[]>('list_mcp_servers')
        logger.info('[mcpStore] Loaded MCP servers:', servers.length)
        set((draft) => {
          draft.servers = servers
          draft.isLoading = false
        })

        const enabledMcpServers = servers.filter((s) => isMcpTool(s) && s.is_enabled)
        for (const server of enabledMcpServers) {
          const status = get().connectionStatus[server.id]
          if (!status || status === 'idle' || status === 'error' || status === 'needs_auth') {
            get().connectServer(server.id)
          }
        }
      } catch (error) {
        logger.error('[mcpStore] Failed to load MCP servers:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
      }
    },

    ensureLoaded: async () => {
      const state = get()
      if (state.servers.length === 0 && !state.isLoading) {
        await get().loadServers()
      }
    },

    createServer: async (
      name: string,
      endpoint?: string,
      description?: string,
      config?: McpServerConfig
    ) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const server = await invoke<Tool>('create_mcp_server', {
          name,
          endpoint,
          description,
          config,
        })
        logger.info('[mcpStore] Created MCP server:', server.name)
        set((draft) => {
          draft.servers.push(server)
          draft.isLoading = false
        })
        return server
      } catch (error) {
        logger.error('[mcpStore] Failed to create MCP server:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    updateServer: async (
      id: string,
      name: string,
      endpoint?: string,
      description?: string,
      config?: McpServerConfig,
      isEnabled?: boolean
    ) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const server = await invoke<Tool>('update_mcp_server', {
          id,
          name,
          endpoint,
          description,
          config,
          isEnabled,
        })
        logger.info('[mcpStore] Updated MCP server:', server.name)
        set((draft) => {
          const index = draft.servers.findIndex((s: Tool) => s.id === id)
          if (index >= 0) {
            draft.servers[index] = server
          }
          draft.isLoading = false
        })
        return server
      } catch (error) {
        logger.error('[mcpStore] Failed to update MCP server:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    deleteServer: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        await invoke('delete_mcp_server', { id })
        logger.info('[mcpStore] Deleted MCP server:', id)
        set((draft) => {
          draft.servers = draft.servers.filter((s: Tool) => s.id !== id)
          draft.isLoading = false
          delete draft.needsAuth[id]
        })
      } catch (error) {
        logger.error('[mcpStore] Failed to delete MCP server:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    toggleServer: async (id: string) => {
      set((draft) => {
        draft.isLoading = true
        draft.error = null
      })
      try {
        const server = await invoke<Tool>('toggle_mcp_server', { id })
        logger.info('[mcpStore] Toggled MCP server:', {
          name: server.name,
          enabled: server.is_enabled,
        })
        set((draft) => {
          const index = draft.servers.findIndex((s: Tool) => s.id === id)
          if (index >= 0) {
            draft.servers[index] = server
          }
          draft.isLoading = false
        })
        return server
      } catch (error) {
        logger.error('[mcpStore] Failed to toggle MCP server:', error)
        set((draft) => {
          draft.error = String(error)
          draft.isLoading = false
        })
        throw error
      }
    },

    setAllEnabled: async (toolType: string, enabled: boolean) => {
      try {
        const tools = await invoke<Tool[]>('set_all_tools_enabled', { toolType, enabled })
        logger.info('[mcpStore] Set all tools enabled:', { toolType, enabled, count: tools.length })
        set((draft) => {
          const otherTools = draft.servers.filter((s: Tool) => s.type !== toolType)
          draft.servers = [...otherTools, ...tools]
        })
      } catch (error) {
        logger.error('[mcpStore] Failed to set all tools enabled:', error)
        throw error
      }
    },

    testHttpConnection: async (endpoint: string) => {
      set((draft) => {
        draft.testingEndpoint = endpoint
        draft.testResult = null
        draft.testError = null
      })
      try {
        const tools = await invoke<McpToolInfo[]>('test_mcp_connection', { endpoint })
        logger.info('[mcpStore] HTTP test connection successful:', { count: tools.length })
        set((draft) => {
          draft.testResult = tools
          draft.testingEndpoint = null
        })
        return tools
      } catch (error) {
        logger.error('[mcpStore] HTTP test connection failed:', error)
        set((draft) => {
          draft.testError = String(error)
          draft.testingEndpoint = null
        })
        throw error
      }
    },

    testStdioConnection: async (config: McpServerConfig) => {
      set((draft) => {
        draft.testingEndpoint = config.command || 'stdio'
        draft.testResult = null
        draft.testError = null
      })
      try {
        const tools = await invoke<McpToolInfo[]>('test_mcp_stdio_connection', { config })
        logger.info('[mcpStore] STDIO test connection successful:', { count: tools.length })
        set((draft) => {
          draft.testResult = tools
          draft.testingEndpoint = null
        })
        return tools
      } catch (error) {
        logger.error('[mcpStore] STDIO test connection failed:', error)
        set((draft) => {
          draft.testError = String(error)
          draft.testingEndpoint = null
        })
        throw error
      }
    },

    listServerTools: async (id: string) => {
      try {
        const tools = await invoke<McpToolInfo[]>('list_mcp_server_tools', { id })
        logger.info('[mcpStore] Listed tools for server:', { id, count: tools.length })
        return tools
      } catch (error) {
        logger.error('[mcpStore] Failed to list server tools:', error)
        throw error
      }
    },

    getServerById: (id: string) => {
      return get().servers.find((s) => s.id === id)
    },

    clearTestResult: () => {
      set((draft) => {
        draft.testResult = null
        draft.testError = null
        draft.testingEndpoint = null
      })
    },

    connectServer: async (id: string) => {
      set((draft) => {
        draft.connectionStatus[id] = 'connecting'
        delete draft.connectionErrors[id]
        delete draft.probeResults[id]
      })
      try {
        await invoke('disconnect_mcp_server', { id })
        const tools = await invoke<McpToolInfo[]>('list_mcp_server_tools', { id })
        logger.info('[mcpStore] Connected to server:', { id, toolCount: tools.length })
        set((draft) => {
          draft.connectionStatus[id] = 'connected'
          draft.serverTools[id] = tools
          delete draft.needsAuth[id]
        })
      } catch (error) {
        logger.error('[mcpStore] Failed to connect to server:', { id, error })
        set((draft) => {
          draft.connectionStatus[id] = 'error'
          draft.connectionErrors[id] = String(error)
          delete draft.serverTools[id]
        })

        // Auto-probe for HTTP servers to detect OAuth requirements
        const server = get().servers.find((s) => s.id === id)
        if (server && getTransportType(server) === 'http') {
          try {
            await get().probeEndpoint(id)
          } catch {
            // probe errors already handled inside probeEndpoint
          }
        }
      }
    },

    probeEndpoint: async (id: string) => {
      try {
        const result = await invoke<ProbeResult>('probe_mcp_endpoint', { serverId: id })
        logger.info('[mcpStore] Probe result for server:', { id, status: result.status })
        set((draft) => {
          draft.probeResults[id] = result
          if (result.status === 'needs_oauth') {
            draft.connectionStatus[id] = 'needs_auth'
            draft.needsAuth[id] = true
          }
        })
        return result
      } catch (error) {
        logger.error('[mcpStore] Probe failed for server:', { id, error })
        const errorResult: ProbeResult = {
          status: 'error',
          error: String(error),
        }
        set((draft) => {
          draft.probeResults[id] = errorResult
        })
        return errorResult
      }
    },

    getConnectionStatus: (id: string) => {
      return get().connectionStatus[id] || 'idle'
    },

    getServerToolsCached: (id: string) => {
      return get().serverTools[id] || []
    },

    startOAuth: async (serverId: string) => {
      const { auth_url: authUrl } = await invoke<{ auth_url: string; redirect_uri: string }>(
        'start_mcp_oauth',
        { serverId }
      )
      await openUrl(authUrl)
      const tool = await invoke<Tool>('complete_mcp_oauth', { serverId })
      set((draft) => {
        const index = draft.servers.findIndex((s: Tool) => s.id === serverId)
        if (index >= 0) draft.servers[index] = tool
      })
      return tool
    },

    checkOAuthStatus: async (serverId: string) => {
      const result = await invoke<OAuthStatusResult>('check_mcp_oauth_status', { serverId })
      return result
    },

    revokeOAuth: async (serverId: string) => {
      await invoke('revoke_mcp_oauth', { serverId })
      await get().loadServers()
    },

    setBearerToken: async (serverId: string, token: string) => {
      await invoke('set_mcp_bearer_token', { serverId, token })
    },

    reportNeedsAuth: (conversationId: string, serverId: string) => {
      set((draft) => {
        draft.connectionStatus[serverId] = 'needs_auth'
        draft.needsAuth[serverId] = true
        const reported = draft.authReports[conversationId] ?? []
        if (!reported.includes(serverId)) {
          draft.authReports[conversationId] = [...reported, serverId]
        }
      })
    },

    // A send connected these servers (possibly after a silent refresh).
    markServersConnected: (serverIds: string[]) => {
      if (!serverIds.some((id) => get().needsAuth[id])) return
      set((draft) => {
        for (const id of serverIds) {
          if (!draft.needsAuth[id]) continue
          delete draft.needsAuth[id]
          draft.connectionStatus[id] = 'connected'
        }
      })
    },

    setToolProgress: (conversationId: string, toolName: string, progress: McpToolProgress) => {
      set((draft) => {
        draft.toolProgress[conversationId] ??= {}
        draft.toolProgress[conversationId][toolName] = progress
      })
    },

    clearToolProgress: (conversationId: string, toolName: string) => {
      if (!get().toolProgress[conversationId]?.[toolName]) return
      set((draft) => {
        delete draft.toolProgress[conversationId][toolName]
      })
    },

    // The server's tool list changed: refresh it where settings shows it.
    refreshServerTools: async (id: string) => {
      if (!get().serverTools[id]) return
      try {
        const tools = await invoke<McpToolInfo[]>('list_mcp_server_tools', { id })
        set((draft) => {
          draft.serverTools[id] = tools
        })
      } catch (error) {
        logger.warn('[mcpStore] Failed to refresh tools after list change:', { id, error })
      }
    },

    clearAuthReport: (conversationId: string, serverId: string) => {
      set((draft) => {
        const reported = draft.authReports[conversationId]
        if (!reported) return
        draft.authReports[conversationId] = reported.filter((id) => id !== serverId)
      })
    },

    // Sign in again from the chat; the completion flow already drops the
    // cached connection, and a successful reconnect clears needsAuth.
    reauthorize: async (serverId: string) => {
      await get().startOAuth(serverId)
      await get().loadServers()
      await get().connectServer(serverId)
    },

    // A sync may have delivered a usable grant from another device:
    // reloading reconnects every needs-auth server, and a successful
    // connect clears its banner.
    recheckNeedsAuth: async () => {
      if (Object.keys(get().needsAuth).length === 0) return
      await get().loadServers()
    },
  }))
)
