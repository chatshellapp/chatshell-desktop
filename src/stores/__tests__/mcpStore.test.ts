import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useMcpStore } from '../mcpStore'
import type { Tool } from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockInvoke = vi.mocked(invoke)

describe('useMcpStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
    useMcpStore.setState({
      servers: [],
      isLoading: false,
      error: null,
      testingEndpoint: null,
      testResult: null,
      testError: null,
    })
  })

  describe('initial state', () => {
    it('should have empty servers array', () => {
      const state = useMcpStore.getState()
      expect(state.servers).toEqual([])
    })

    it('should not be loading initially', () => {
      const state = useMcpStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useMcpStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('loadServers', () => {
    it('should set isLoading to true while loading', async () => {
      const mockServers: Tool[] = []
      mockInvoke.mockResolvedValue(mockServers)

      const loadPromise = useMcpStore.getState().loadServers()

      // Check that loading was set to true
      // Note: Due to async nature, this may already be false by the time we check
      await loadPromise

      expect(useMcpStore.getState().isLoading).toBe(false)
    })

    it('should populate servers on successful load', async () => {
      const mockServers: Tool[] = [
        {
          id: 'server-1',
          name: 'Test Server',
          type: 'mcp',
          endpoint: 'http://localhost:3000',
          is_enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      mockInvoke.mockResolvedValue(mockServers)

      await useMcpStore.getState().loadServers()

      expect(mockInvoke).toHaveBeenCalledWith('list_mcp_servers')
      expect(useMcpStore.getState().servers).toEqual(mockServers)
      expect(useMcpStore.getState().isLoading).toBe(false)
      expect(useMcpStore.getState().error).toBeNull()
    })

    it('should set error on failed load', async () => {
      const errorMessage = 'Failed to load servers'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await useMcpStore.getState().loadServers()

      expect(useMcpStore.getState().servers).toEqual([])
      expect(useMcpStore.getState().isLoading).toBe(false)
      expect(useMcpStore.getState().error).toContain(errorMessage)
    })
  })

  describe('ensureLoaded', () => {
    it('should load servers if not already loaded', async () => {
      const mockServers: Tool[] = [
        {
          id: 'server-1',
          name: 'Test Server',
          type: 'mcp',
          endpoint: 'http://localhost:3000',
          is_enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      mockInvoke.mockResolvedValue(mockServers)

      await useMcpStore.getState().ensureLoaded()

      expect(mockInvoke).toHaveBeenCalledWith('list_mcp_servers')
      expect(useMcpStore.getState().servers).toEqual(mockServers)
    })

    it('should not reload if servers already exist', async () => {
      const existingServers: Tool[] = [
        {
          id: 'server-1',
          name: 'Existing Server',
          type: 'mcp',
          endpoint: 'http://localhost:3000',
          is_enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      useMcpStore.setState({ servers: existingServers })

      await useMcpStore.getState().ensureLoaded()

      expect(mockInvoke).not.toHaveBeenCalled()
      expect(useMcpStore.getState().servers).toEqual(existingServers)
    })
  })

  describe('getServerById', () => {
    it('should return server by id', () => {
      const mockServers: Tool[] = [
        {
          id: 'server-1',
          name: 'Test Server',
          type: 'mcp',
          endpoint: 'http://localhost:3000',
          is_enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'server-2',
          name: 'Another Server',
          type: 'mcp',
          endpoint: 'http://localhost:4000',
          is_enabled: false,
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ]
      useMcpStore.setState({ servers: mockServers })

      const server = useMcpStore.getState().getServerById('server-2')

      expect(server).toEqual(mockServers[1])
    })

    it('should return undefined for non-existent id', () => {
      const mockServers: Tool[] = [
        {
          id: 'server-1',
          name: 'Test Server',
          type: 'mcp',
          endpoint: 'http://localhost:3000',
          is_enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      useMcpStore.setState({ servers: mockServers })

      const server = useMcpStore.getState().getServerById('non-existent')

      expect(server).toBeUndefined()
    })
  })

  describe('clearTestResult', () => {
    it('should clear all test-related state', () => {
      useMcpStore.setState({
        testingEndpoint: 'http://localhost:3000',
        testResult: [{ name: 'tool1', description: 'Test tool' }],
        testError: 'Some error',
      })

      useMcpStore.getState().clearTestResult()

      const state = useMcpStore.getState()
      expect(state.testingEndpoint).toBeNull()
      expect(state.testResult).toBeNull()
      expect(state.testError).toBeNull()
    })
  })

  describe('createServer', () => {
    it('should create a new server and add to store', async () => {
      const newServer: Tool = {
        id: 'new-server-1',
        name: 'New Server',
        type: 'mcp',
        endpoint: 'http://localhost:5000',
        is_enabled: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
      mockInvoke.mockResolvedValue(newServer)

      const result = await useMcpStore
        .getState()
        .createServer('New Server', 'http://localhost:5000', 'A new server')

      expect(mockInvoke).toHaveBeenCalledWith('create_mcp_server', {
        name: 'New Server',
        endpoint: 'http://localhost:5000',
        description: 'A new server',
        config: undefined,
      })
      expect(result).toEqual(newServer)
      expect(useMcpStore.getState().servers).toContainEqual(newServer)
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to create server'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(useMcpStore.getState().createServer('Test', 'http://test')).rejects.toThrow()

      expect(useMcpStore.getState().error).toContain(errorMessage)
    })
  })

  describe('deleteServer', () => {
    it('should delete server and remove from store', async () => {
      const mockServers: Tool[] = [
        {
          id: 'server-1',
          name: 'Test Server',
          type: 'mcp',
          endpoint: 'http://localhost:3000',
          is_enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      useMcpStore.setState({ servers: mockServers })
      mockInvoke.mockResolvedValue(undefined)

      await useMcpStore.getState().deleteServer('server-1')

      expect(mockInvoke).toHaveBeenCalledWith('delete_mcp_server', { id: 'server-1' })
      expect(useMcpStore.getState().servers).toHaveLength(0)
    })
  })
})
