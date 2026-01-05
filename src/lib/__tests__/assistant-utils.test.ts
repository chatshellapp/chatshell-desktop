import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PRESET_COLORS,
  FEMALE_EMOJIS,
  MALE_EMOJIS,
  getRandomPresetColor,
  getRandomNameAndEmoji,
  generateRandomAvatarData,
} from '../assistant-utils'

describe('assistant-utils', () => {
  describe('constants', () => {
    it('should have valid preset colors', () => {
      expect(PRESET_COLORS).toHaveLength(3)
      PRESET_COLORS.forEach((color) => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      })
    })

    it('should have female emojis', () => {
      expect(FEMALE_EMOJIS.length).toBeGreaterThan(0)
    })

    it('should have male emojis', () => {
      expect(MALE_EMOJIS.length).toBeGreaterThan(0)
    })
  })

  describe('getRandomPresetColor', () => {
    it('should return a valid preset color', () => {
      const color = getRandomPresetColor()
      expect(PRESET_COLORS).toContain(color)
    })

    it('should return different colors over multiple calls (statistical test)', () => {
      const colors = new Set<string>()
      // Run 100 times - statistically should get at least 2 different colors
      for (let i = 0; i < 100; i++) {
        colors.add(getRandomPresetColor())
      }
      expect(colors.size).toBeGreaterThan(1)
    })
  })

  describe('getRandomNameAndEmoji', () => {
    it('should return an object with name and emoji', () => {
      const result = getRandomNameAndEmoji()
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('emoji')
      expect(typeof result.name).toBe('string')
      expect(typeof result.emoji).toBe('string')
    })

    it('should return non-empty name and emoji', () => {
      const result = getRandomNameAndEmoji()
      expect(result.name.length).toBeGreaterThan(0)
      expect(result.emoji.length).toBeGreaterThan(0)
    })

    it('should return emoji from predefined sets', () => {
      const allEmojis = [...FEMALE_EMOJIS, ...MALE_EMOJIS]
      // Run multiple times to ensure we're getting valid emojis
      for (let i = 0; i < 20; i++) {
        const result = getRandomNameAndEmoji()
        expect(allEmojis).toContain(result.emoji)
      }
    })
  })

  describe('generateRandomAvatarData', () => {
    it('should return name, emoji, and color', () => {
      const result = generateRandomAvatarData()
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('emoji')
      expect(result).toHaveProperty('color')
    })

    it('should return valid preset color', () => {
      const result = generateRandomAvatarData()
      expect(PRESET_COLORS).toContain(result.color)
    })

    it('should return non-empty values', () => {
      const result = generateRandomAvatarData()
      expect(result.name.length).toBeGreaterThan(0)
      expect(result.emoji.length).toBeGreaterThan(0)
      expect(result.color.length).toBeGreaterThan(0)
    })
  })

  describe('randomness with mocked Math.random', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('should return female name/emoji when random < 0.5', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1)
      const result = getRandomNameAndEmoji()
      expect(FEMALE_EMOJIS).toContain(result.emoji)
    })

    it('should return male name/emoji when random >= 0.5', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.9)
      const result = getRandomNameAndEmoji()
      expect(MALE_EMOJIS).toContain(result.emoji)
    })
  })
})

