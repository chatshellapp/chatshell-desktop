import { describe, it, expect } from 'vitest'
import { getDomain, getFaviconUrl, formatFileSize, isMarkdownFile } from '../utils'
import type { FetchResult } from '@/types'

const createMockFetchResult = (overrides: Partial<FetchResult> = {}): FetchResult => ({
  id: 'fetch-1',
  url: 'https://example.com/page',
  title: 'Example Page',
  source_type: 'user_link',
  storage_path: 'fetch/abc123.md',
  content_type: 'text/markdown',
  status: 'success',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('attachment-preview utils', () => {
  describe('getDomain', () => {
    it('should extract domain from valid URL', () => {
      expect(getDomain('https://example.com/page')).toBe('example.com')
      expect(getDomain('https://www.google.com/search?q=test')).toBe('www.google.com')
      expect(getDomain('http://localhost:3000/api')).toBe('localhost')
    })

    it('should handle URLs with subdomains', () => {
      expect(getDomain('https://docs.github.com/en/pages')).toBe('docs.github.com')
      expect(getDomain('https://api.openai.com/v1/chat')).toBe('api.openai.com')
    })

    it('should handle URLs with ports', () => {
      expect(getDomain('http://localhost:8080/api')).toBe('localhost')
      expect(getDomain('https://example.com:443/secure')).toBe('example.com')
    })

    it('should return original string for invalid URL', () => {
      expect(getDomain('not a url')).toBe('not a url')
      expect(getDomain('ftp://invalid')).toBe('invalid')
      expect(getDomain('')).toBe('')
    })
  })

  describe('getFaviconUrl', () => {
    it('should return stored favicon_url if available', () => {
      const fetchResult = createMockFetchResult({
        favicon_url: 'https://example.com/favicon.ico',
      })
      expect(getFaviconUrl(fetchResult)).toBe('https://example.com/favicon.ico')
    })

    it('should fallback to Google favicon service when no favicon_url', () => {
      const fetchResult = createMockFetchResult({
        url: 'https://github.com/user/repo',
        favicon_url: undefined,
      })
      expect(getFaviconUrl(fetchResult)).toBe(
        'https://www.google.com/s2/favicons?domain=github.com&sz=32'
      )
    })

    it('should return empty string for invalid URL without favicon', () => {
      const fetchResult = createMockFetchResult({
        url: 'invalid url',
        favicon_url: undefined,
      })
      expect(getFaviconUrl(fetchResult)).toBe('')
    })
  })

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(100)).toBe('100 B')
      expect(formatFileSize(1023)).toBe('1023 B')
    })

    it('should format KB correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
      expect(formatFileSize(10240)).toBe('10.0 KB')
      expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB')
    })

    it('should format MB correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
      expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB')
      expect(formatFileSize(100 * 1024 * 1024)).toBe('100.0 MB')
    })
  })

  describe('isMarkdownFile', () => {
    it('should detect .md extension', () => {
      expect(isMarkdownFile('README.md')).toBe(true)
      expect(isMarkdownFile('document.MD')).toBe(true)
      expect(isMarkdownFile('path/to/file.md')).toBe(true)
    })

    it('should detect .markdown extension', () => {
      expect(isMarkdownFile('README.markdown')).toBe(true)
      expect(isMarkdownFile('document.MARKDOWN')).toBe(true)
    })

    it('should detect markdown mime types', () => {
      expect(isMarkdownFile('file.txt', 'text/markdown')).toBe(true)
      expect(isMarkdownFile('file.txt', 'text/x-markdown')).toBe(true)
    })

    it('should return false for non-markdown files', () => {
      expect(isMarkdownFile('file.txt')).toBe(false)
      expect(isMarkdownFile('file.html')).toBe(false)
      expect(isMarkdownFile('file.pdf')).toBe(false)
      expect(isMarkdownFile('file.json')).toBe(false)
    })

    it('should return false for files with md in name but different extension', () => {
      expect(isMarkdownFile('markdown-editor.js')).toBe(false)
      expect(isMarkdownFile('md_utils.py')).toBe(false)
    })
  })
})
