import type { FetchResult } from '@/types'

// Extract domain from URL
export function getDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return url
  }
}

// Get favicon URL for a fetch result
export function getFaviconUrl(fetchResult: FetchResult): string {
  // First try to use the stored favicon_url
  if (fetchResult.favicon_url) {
    return fetchResult.favicon_url
  }

  // Fallback to Google favicon service
  try {
    const urlObj = new URL(fetchResult.url)
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`
  } catch {
    return ''
  }
}

// Helper function to format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Helper function to check if file is markdown
export function isMarkdownFile(fileName: string, mimeType?: string): boolean {
  const lowerName = fileName.toLowerCase()
  return (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    mimeType === 'text/markdown' ||
    mimeType === 'text/x-markdown'
  )
}
