import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { invoke } from '@tauri-apps/api/core'
import type { Tool } from '@/types'
import { logger } from '@/lib/logger'

// MCP tool info returned from server
export interface McpToolInfo {
  name: string
  description?: string
}

interface McpState {
  // MCP servers (stored as Tool with type='mcp')
  servers: Tool[]
  isLoading: boolean
  error: string | null

  // Connection testing state
  testingEndpoint: string | null
  testResult: McpToolInfo[] | null
  testError: string | null

  // Actions
  loadServers: () => Promise<void>
  ensureLoaded: () => Promise<void>
  createServer: (
    name: string,
    endpoint: string,
    description?: string,
    config?: string
  ) => Promise<Tool>
  updateServer: (
    id: string,
    name: string,
    endpoint: string,
    description?: string,
    config?: string,
    isEnabled?: boolean
  ) => Promise<Tool>
  deleteServer: (id: string) => Promise<void>
  toggleServer: (id: string) => Promise<Tool>
  testConnection: (endpoint: string) => Promise<McpToolInfo[]>
  listServerTools: (id: string) => Promise<McpToolInfo[]>
  getServerById: (id: string) => Tool | undefined
  clearTestResult: () => void
}

export const useMcpStore = create<McpState>()(
  immer((set, get) => ({
    servers: [],
    isLoading: false,
    error: null,
    testingEndpoint: null,
    testResult: null,
    testError: null,

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

    createServer: async (name: string, endpoint: string, description?: string, config?: string) => {
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
      endpoint: string,
      description?: string,
      config?: string,
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

    testConnection: async (endpoint: string) => {
      set((draft) => {
        draft.testingEndpoint = endpoint
        draft.testResult = null
        draft.testError = null
      })
      try {
        const tools = await invoke<McpToolInfo[]>('test_mcp_connection', { endpoint })
        logger.info('[mcpStore] Test connection successful:', { count: tools.length })
        set((draft) => {
          draft.testResult = tools
          draft.testingEndpoint = null
        })
        return tools
      } catch (error) {
        logger.error('[mcpStore] Test connection failed:', error)
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
  }))
)
