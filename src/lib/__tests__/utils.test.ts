import { describe, it, expect } from 'vitest'
import { cn, parseThinkingContent, formatConversationTimestamp } from '../utils'

describe('cn utility', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('should handle conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  it('should handle undefined and null values', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })

  it('should handle array of classes', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('should merge tailwind classes properly', () => {
    // tailwind-merge should prioritize later classes
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('should handle empty inputs', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
  })
})

describe('parseThinkingContent', () => {
  it('should return original content when no thinking tags present', () => {
    const result = parseThinkingContent('Hello world')
    expect(result.content).toBe('Hello world')
    expect(result.thinkingContent).toBeNull()
    expect(result.isThinkingInProgress).toBe(false)
  })

  it('should extract content from <think> tags', () => {
    const result = parseThinkingContent('<think>thinking here</think>visible content')
    expect(result.content).toBe('visible content')
    expect(result.thinkingContent).toBe('thinking here')
    expect(result.isThinkingInProgress).toBe(false)
  })

  it('should extract content from <thinking> tags', () => {
    const result = parseThinkingContent('<thinking>my thoughts</thinking>main content')
    expect(result.content).toBe('main content')
    expect(result.thinkingContent).toBe('my thoughts')
    expect(result.isThinkingInProgress).toBe(false)
  })

  it('should extract content from <reasoning> tags', () => {
    const result = parseThinkingContent('<reasoning>my reasoning</reasoning>output')
    expect(result.content).toBe('output')
    expect(result.thinkingContent).toBe('my reasoning')
    expect(result.isThinkingInProgress).toBe(false)
  })

  it('should handle multiple thinking blocks', () => {
    const result = parseThinkingContent(
      '<think>first thought</think>content<thinking>second thought</thinking>'
    )
    expect(result.content).toBe('content')
    expect(result.thinkingContent).toBe('first thought\n\nsecond thought')
  })

  it('should detect unclosed thinking tags (streaming)', () => {
    const result = parseThinkingContent('<think>partial thinking...')
    expect(result.content).toBe('')
    expect(result.thinkingContent).toBe('partial thinking...')
    expect(result.isThinkingInProgress).toBe(true)
  })

  it('should handle case insensitive tags', () => {
    const result = parseThinkingContent('<THINK>upper case</THINK>content')
    expect(result.content).toBe('content')
    expect(result.thinkingContent).toBe('upper case')
  })

  it('should handle multiline thinking content', () => {
    const result = parseThinkingContent('<think>line1\nline2\nline3</think>output')
    expect(result.content).toBe('output')
    expect(result.thinkingContent).toBe('line1\nline2\nline3')
  })

  it('should handle empty thinking tags', () => {
    const result = parseThinkingContent('<think></think>content')
    expect(result.content).toBe('content')
    // Empty thinking tag content after trim becomes empty string
    expect(result.thinkingContent).toBe('')
  })
})

describe('formatConversationTimestamp', () => {
  it('should return "Just now" for recent timestamps', () => {
    const now = new Date().toISOString()
    expect(formatConversationTimestamp(now)).toBe('Just now')
  })

  it('should return minutes ago for recent messages', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(formatConversationTimestamp(fiveMinAgo)).toBe('5 min ago')
  })

  it('should return hours ago correctly', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(formatConversationTimestamp(twoHoursAgo)).toBe('2 hours ago')
  })

  it('should return "1 hour ago" for singular hour', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    expect(formatConversationTimestamp(oneHourAgo)).toBe('1 hour ago')
  })

  it('should return "Yesterday" for yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(formatConversationTimestamp(yesterday)).toBe('Yesterday')
  })

  it('should return days ago for recent days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatConversationTimestamp(threeDaysAgo)).toBe('3 days ago')
  })
})

