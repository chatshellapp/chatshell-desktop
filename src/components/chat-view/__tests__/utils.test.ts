import { describe, it, expect } from 'vitest'
import { formatModelDisplayName, CHAT_CONFIG, formatTimestamp } from '../utils'

describe('chat-view utils', () => {
  describe('formatModelDisplayName', () => {
    it('should format with provider name when provider exists', () => {
      const getProviderById = (id: string) => {
        if (id === 'provider-1') return { name: 'OpenAI' }
        return undefined
      }

      const result = formatModelDisplayName('GPT-4', 'provider-1', getProviderById)
      expect(result).toBe('GPT-4 - OpenAI')
    })

    it('should return model name only when provider not found', () => {
      const getProviderById = () => undefined

      const result = formatModelDisplayName('GPT-4', 'unknown-provider', getProviderById)
      expect(result).toBe('GPT-4')
    })

    it('should handle different provider names', () => {
      const providers: Record<string, { name: string }> = {
        'provider-1': { name: 'OpenAI' },
        'provider-2': { name: 'Anthropic' },
        'provider-3': { name: 'OpenRouter' },
      }
      const getProviderById = (id: string) => providers[id]

      expect(formatModelDisplayName('Claude 3', 'provider-2', getProviderById)).toBe(
        'Claude 3 - Anthropic'
      )
      expect(formatModelDisplayName('Mixtral', 'provider-3', getProviderById)).toBe(
        'Mixtral - OpenRouter'
      )
    })
  })

  describe('CHAT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(CHAT_CONFIG.userMessageAlign).toBe('right')
      expect(CHAT_CONFIG.userMessageShowBackground).toBe(true)
    })

    it('should be a constant object', () => {
      expect(typeof CHAT_CONFIG).toBe('object')
      expect(CHAT_CONFIG).toHaveProperty('userMessageAlign')
      expect(CHAT_CONFIG).toHaveProperty('userMessageShowBackground')
    })
  })

  describe('formatTimestamp', () => {
    it('should format ISO string to locale string', () => {
      const isoString = '2024-01-15T10:30:00Z'
      const result = formatTimestamp(isoString)

      // Result should be a non-empty string
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should handle different ISO formats', () => {
      const dates = ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', '2024-06-15T12:00:00.000Z']

      dates.forEach((isoString) => {
        const result = formatTimestamp(isoString)
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })
    })

    it('should return a parseable date string', () => {
      const isoString = '2024-03-15T14:30:00Z'
      const result = formatTimestamp(isoString)

      // The result should contain numeric characters (from date/time)
      expect(result).toMatch(/\d/)
    })
  })
})
