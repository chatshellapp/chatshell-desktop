import { Globe, FileText, Image, BookOpen, Plug } from 'lucide-react'
import React from 'react'

export type AttachmentType = 'webpage' | 'file' | 'image' | 'knowledge' | 'tools'

export interface Attachment {
  id: string
  type: AttachmentType
  name: string
  // For file attachments
  content?: string
  // For image attachments
  base64?: string
  // Common metadata
  mimeType?: string
  size?: number
}

// Supported file extensions
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  'md',
  'txt',
  'json',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'css',
  'html',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'sh',
  'bash',
  'zsh',
  'sql',
]

export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

// Helper function to get MIME type from file extension
export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    md: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    js: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    jsx: 'text/javascript',
    py: 'text/x-python',
    rs: 'text/x-rust',
    go: 'text/x-go',
    java: 'text/x-java',
    c: 'text/x-c',
    cpp: 'text/x-c++',
    h: 'text/x-c',
    css: 'text/css',
    html: 'text/html',
    xml: 'text/xml',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    toml: 'text/toml',
    ini: 'text/plain',
    sh: 'text/x-shellscript',
    bash: 'text/x-shellscript',
    zsh: 'text/x-shellscript',
    sql: 'text/x-sql',
  }
  return mimeTypes[ext || ''] || 'text/plain'
}

// Helper function to get image MIME type from file extension
export function getImageMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  }
  return mimeTypes[ext || ''] || 'image/png'
}

// Helper function to format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Helper function to check if file type is supported
export function getFileType(fileName: string): 'document' | 'image' | 'unsupported' {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (SUPPORTED_DOCUMENT_EXTENSIONS.includes(ext)) return 'document'
  return 'unsupported'
}

// Helper function to get icon for attachment type
export function getAttachmentIcon(type: AttachmentType): React.ReactNode {
  switch (type) {
    case 'webpage':
      return React.createElement(Globe, { className: 'size-3' })
    case 'file':
      return React.createElement(FileText, { className: 'size-3' })
    case 'image':
      return React.createElement(Image, { className: 'size-3' })
    case 'knowledge':
      return React.createElement(BookOpen, { className: 'size-3' })
    case 'tools':
      return React.createElement(Plug, { className: 'size-3' })
  }
}

// URL regex pattern to detect URLs (handles URLs within sentences)
export const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)/g
