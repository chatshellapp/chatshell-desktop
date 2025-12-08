import femaleNames from '@/assets/data/names/female_names.json'
import maleNames from '@/assets/data/names/male_names.json'

export const PRESET_COLORS = ['#00E5FF', '#FF4081', '#E040FB']
export const FEMALE_EMOJIS = ['👩‍💼', '🤵‍♀️', '👩‍💻', '👩‍🎤']
export const MALE_EMOJIS = ['👨‍💼', '🤵‍♂️', '👨‍💻', '👨‍🎤']

export function getRandomPresetColor() {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
}

export function getRandomNameAndEmoji() {
  // Randomly decide gender
  const isFemale = Math.random() < 0.5

  // Select random name based on gender
  const names = isFemale ? femaleNames : maleNames
  const randomName = names[Math.floor(Math.random() * names.length)]

  // Select random emoji based on gender
  const emojis = isFemale ? FEMALE_EMOJIS : MALE_EMOJIS
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)]

  return { name: randomName, emoji: randomEmoji }
}

/**
 * Generate random avatar data for a new assistant
 */
export function generateRandomAvatarData() {
  const { name, emoji } = getRandomNameAndEmoji()
  const color = getRandomPresetColor()
  return { name, emoji, color }
}

