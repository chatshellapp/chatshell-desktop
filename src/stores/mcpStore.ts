import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { Tool, McpServerConfig } from '@/types'
import { isMcpTool } from '@/types'
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

export type McpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

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
  getConnectionStatus: (id: string) => McpConnectionStatus
  getServerToolsCached: (id: string) => McpToolInfo[]

  // OAuth and Bearer auth (HTTP transport only)
  startOAuth: (serverId: string) => Promise<Tool>
  checkOAuthStatus: (serverId: string) => Promise<OAuthStatusResult>
  revokeOAuth: (serverId: string) => Promise<void>
  setBearerToken: (serverId: string, token: string) => Promise<void>
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
          if (!status || status === 'idle' || status === 'error') {
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
      })
      try {
        const tools = await invoke<McpToolInfo[]>('list_mcp_server_tools', { id })
        logger.info('[mcpStore] Connected to server:', { id, toolCount: tools.length })
        set((draft) => {
          draft.connectionStatus[id] = 'connected'
          draft.serverTools[id] = tools
        })
      } catch (error) {
        logger.error('[mcpStore] Failed to connect to server:', { id, error })
        set((draft) => {
          draft.connectionStatus[id] = 'error'
          draft.connectionErrors[id] = String(error)
          delete draft.serverTools[id]
        })
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
  }))
)
