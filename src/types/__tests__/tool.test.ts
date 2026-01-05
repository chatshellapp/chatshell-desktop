import { describe, it, expect } from 'vitest'
import {
  isBuiltinTool,
  isMcpTool,
  parseMcpConfig,
  getTransportType,
  TOOL_TYPE_BUILTIN,
  TOOL_TYPE_MCP,
  type Tool,
  type McpServerConfig,
} from '../tool'

const createMockTool = (overrides: Partial<Tool> = {}): Tool => ({
  id: 'tool-1',
  name: 'Test Tool',
  type: 'mcp',
  is_enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('Tool utility functions', () => {
  describe('isBuiltinTool', () => {
    it('should return true for builtin tools', () => {
      const tool = createMockTool({ type: TOOL_TYPE_BUILTIN })
      expect(isBuiltinTool(tool)).toBe(true)
    })

    it('should return false for MCP tools', () => {
      const tool = createMockTool({ type: TOOL_TYPE_MCP })
      expect(isBuiltinTool(tool)).toBe(false)
    })

    it('should return false for other tool types', () => {
      const tool = createMockTool({ type: 'server' })
      expect(isBuiltinTool(tool)).toBe(false)
    })
  })

  describe('isMcpTool', () => {
    it('should return true for MCP tools', () => {
      const tool = createMockTool({ type: TOOL_TYPE_MCP })
      expect(isMcpTool(tool)).toBe(true)
    })

    it('should return false for builtin tools', () => {
      const tool = createMockTool({ type: TOOL_TYPE_BUILTIN })
      expect(isMcpTool(tool)).toBe(false)
    })

    it('should return false for other tool types', () => {
      const tool = createMockTool({ type: 'api' })
      expect(isMcpTool(tool)).toBe(false)
    })
  })

  describe('parseMcpConfig', () => {
    it('should parse valid JSON config', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      }
      const configStr = JSON.stringify(config)

      const result = parseMcpConfig(configStr)

      expect(result).toEqual(config)
      expect(result?.transport).toBe('stdio')
      expect(result?.command).toBe('npx')
      expect(result?.args).toEqual(['-y', '@modelcontextprotocol/server-everything'])
    })

    it('should parse HTTP transport config', () => {
      const config: McpServerConfig = { transport: 'http' }
      const configStr = JSON.stringify(config)

      const result = parseMcpConfig(configStr)

      expect(result?.transport).toBe('http')
    })

    it('should parse config with env variables', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'secret', DEBUG: 'true' },
        cwd: '/path/to/server',
      }
      const configStr = JSON.stringify(config)

      const result = parseMcpConfig(configStr)

      expect(result?.env).toEqual({ API_KEY: 'secret', DEBUG: 'true' })
      expect(result?.cwd).toBe('/path/to/server')
    })

    it('should return null for undefined config', () => {
      expect(parseMcpConfig(undefined)).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseMcpConfig('')).toBeNull()
    })

    it('should return null for invalid JSON', () => {
      expect(parseMcpConfig('not valid json')).toBeNull()
      expect(parseMcpConfig('{ broken: json }')).toBeNull()
    })
  })

  describe('getTransportType', () => {
    it('should return http as default when no config', () => {
      const tool = createMockTool({ config: undefined })
      expect(getTransportType(tool)).toBe('http')
    })

    it('should return http when config specifies http', () => {
      const config: McpServerConfig = { transport: 'http' }
      const tool = createMockTool({ config: JSON.stringify(config) })
      expect(getTransportType(tool)).toBe('http')
    })

    it('should return stdio when config specifies stdio', () => {
      const config: McpServerConfig = { transport: 'stdio', command: 'npx' }
      const tool = createMockTool({ config: JSON.stringify(config) })
      expect(getTransportType(tool)).toBe('stdio')
    })

    it('should return http for invalid config JSON', () => {
      const tool = createMockTool({ config: 'invalid json' })
      expect(getTransportType(tool)).toBe('http')
    })
  })
})
