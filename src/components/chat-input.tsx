import {
  ArrowUpIcon,
  Plus,
  FileText,
  Image,
  Sparkles,
  BookOpen,
  Plug,
  Globe,
  X,
  Square,
  Settings2,
  Search,
  Package,
  Upload,
  Link,
} from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ImageLightbox,
  FilePreviewDialog,
  type ImageAttachmentData,
} from '@/components/attachment-preview'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useConversationStore } from '@/stores/conversationStore'
import { useMessageStore } from '@/stores/messageStore'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import type { Model } from '@/types'
import { ModelList, type ModelVendor, type Model as ModelListModel } from '@/components/model-list'
import {
  AssistantList,
  type AssistantGroup,
  type Assistant as AssistantListAssistant,
} from '@/components/assistant-list'
import { getModelLogo } from '@/lib/model-logos'

type AttachmentType = 'webpage' | 'file' | 'image' | 'knowledge' | 'tools'

interface Attachment {
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

// Helper function to get MIME type from file extension
function getMimeType(fileName: string): string {
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
function getImageMimeType(fileName: string): string {
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
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Supported file extensions
const SUPPORTED_DOCUMENT_EXTENSIONS = [
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

const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

// Helper function to check if file type is supported
function getFileType(fileName: string): 'document' | 'image' | 'unsupported' {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (SUPPORTED_DOCUMENT_EXTENSIONS.includes(ext)) return 'document'
  return 'unsupported'
}

interface ChatInputProps {}

// Helper function to get icon for attachment type
function getAttachmentIcon(type: AttachmentType) {
  switch (type) {
    case 'webpage':
      return <Globe className="size-3" />
    case 'file':
      return <FileText className="size-3" />
    case 'image':
      return <Image className="size-3" />
    case 'knowledge':
      return <BookOpen className="size-3" />
    case 'tools':
      return <Plug className="size-3" />
  }
}

export function ChatInput({}: ChatInputProps) {
  // State
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [activeTab, setActiveTab] = useState<'models' | 'assistants'>('models')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [artifactsEnabled, setArtifactsEnabled] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isWebPageDialogOpen, setIsWebPageDialogOpen] = useState(false)
  const [webPageUrl, setWebPageUrl] = useState('')
  const [webPageUrlError, setWebPageUrlError] = useState('')
  // Preview state for attachments
  const [previewingFileId, setPreviewingFileId] = useState<string | null>(null)
  const [lightboxImageIndex, setLightboxImageIndex] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)

  // Store hooks - use granular selectors to avoid unnecessary re-renders
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const selectedModel = useConversationStore((state) => state.selectedModel)
  const selectedAssistant = useConversationStore((state) => state.selectedAssistant)
  const setSelectedModel = useConversationStore((state) => state.setSelectedModel)
  const setSelectedAssistant = useConversationStore((state) => state.setSelectedAssistant)

  const models = useModelStore((state) => state.models)
  const getModelById = useModelStore((state) => state.getModelById)
  const getProviderById = useModelStore((state) => state.getProviderById)
  const updateModel = useModelStore((state) => state.updateModel)
  const assistants = useAssistantStore((state) => state.assistants)
  const updateAssistant = useAssistantStore((state) => state.updateAssistant)

  // Get conversation-specific state
  const conversationState = useMessageStore((state) =>
    currentConversation ? state.getConversationState(currentConversation.id) : null
  )
  const sendMessage = useMessageStore((state) => state.sendMessage)
  const stopGeneration = useMessageStore((state) => state.stopGeneration)
  const isSending = useMessageStore((state) => state.isSending)

  // Get streaming state from current conversation
  const isStreaming = conversationState?.isStreaming || false
  const isWaitingForAI = conversationState?.isWaitingForAI || false

  // Auto-focus textarea when conversation changes
  useEffect(() => {
    if (currentConversation && textareaRef.current) {
      // Use a small delay to ensure the component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [currentConversation])

  // Debug: log attachments changes
  useEffect(() => {
    console.log(
      '[ChatInput] Attachments updated:',
      attachments.length,
      attachments.map((a) => ({ type: a.type, name: a.name }))
    )
  }, [attachments])

  // URL regex pattern to detect URLs (handles URLs within sentences)
  const urlRegex =
    /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)/g

  const handlePromptSelect = () => {
    console.log('Prompt selected')
  }

  const addAttachment = (type: AttachmentType, name: string) => {
    const newAttachment: Attachment = {
      id: `${type}-${Date.now()}`,
      type,
      name,
    }
    setAttachments([...attachments, newAttachment])
  }

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((att) => att.id !== id))
  }

  const handleFileSelect = async () => {
    try {
      console.log('[handleFileSelect] Opening file dialog...')
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Documents', // Changed from 'Text Files'
            extensions: [
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
            ],
          },
        ],
      })

      console.log('[handleFileSelect] Dialog result:', selected)

      if (!selected) {
        console.log('[handleFileSelect] No file selected')
        return
      }

      const files = Array.isArray(selected) ? selected : [selected]
      console.log('[handleFileSelect] Files to process:', files)

      for (const filePath of files) {
        console.log('[handleFileSelect] Reading file:', filePath)
        // Use Rust command to read file (avoids plugin-fs scope issues)
        const content = await invoke<string>('read_text_file_from_path', { path: filePath })
        console.log('[handleFileSelect] File read, length:', content.length)

        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file'

        const newAttachment: Attachment = {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'file',
          name: fileName,
          content,
          mimeType: getMimeType(fileName),
          size: content.length,
        }
        console.log(
          '[handleFileSelect] Created attachment:',
          newAttachment.name,
          newAttachment.size
        )
        setAttachments((prev) => {
          console.log('[handleFileSelect] Updating attachments, prev count:', prev.length)
          return [...prev, newAttachment]
        })
      }
      console.log('[handleFileSelect] Done processing files')
    } catch (error) {
      console.error('[handleFileSelect] Failed to select file:', error)
    }
  }

  const handleImageSelect = async () => {
    try {
      console.log('[handleImageSelect] Opening file dialog...')
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
          },
        ],
      })

      console.log('[handleImageSelect] Dialog result:', selected)

      if (!selected) {
        console.log('[handleImageSelect] No file selected')
        return
      }

      const files = Array.isArray(selected) ? selected : [selected]
      console.log('[handleImageSelect] Files to process:', files)

      for (const filePath of files) {
        console.log('[handleImageSelect] Reading file:', filePath)
        // Use Rust command to read file as base64 (avoids plugin-fs scope issues)
        const base64 = await invoke<string>('read_file_as_base64', { path: filePath })
        console.log('[handleImageSelect] Base64 length:', base64.length)

        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'image'
        const mimeType = getImageMimeType(fileName)

        // Estimate original file size from base64 length
        const estimatedSize = Math.floor((base64.length * 3) / 4)

        const newAttachment: Attachment = {
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'image',
          name: fileName,
          base64: `data:${mimeType};base64,${base64}`,
          mimeType,
          size: estimatedSize,
        }
        console.log(
          '[handleImageSelect] Created attachment:',
          newAttachment.name,
          newAttachment.size
        )
        setAttachments((prev) => {
          console.log('[handleImageSelect] Updating attachments, prev count:', prev.length)
          return [...prev, newAttachment]
        })
      }
      console.log('[handleImageSelect] Done processing files')
    } catch (error) {
      console.error('[handleImageSelect] Failed to select image:', error)
    }
  }

  const handleKnowledgeBaseSelect = () => {
    addAttachment('knowledge', 'Documentation')
  }

  const handleToolSelect = () => {
    addAttachment('tools', 'Calculator')
  }

  const handleWebPageSelect = () => {
    setWebPageUrl('')
    setWebPageUrlError('')
    setIsWebPageDialogOpen(true)
  }

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  const handleWebPageUrlSubmit = () => {
    const trimmedUrl = webPageUrl.trim()

    if (!trimmedUrl) {
      setWebPageUrlError('Please enter a URL')
      return
    }

    if (!validateUrl(trimmedUrl)) {
      setWebPageUrlError('Please enter a valid URL (e.g., https://example.com)')
      return
    }

    // Check for duplicate
    const isDuplicate = attachments.some((att) => att.type === 'webpage' && att.name === trimmedUrl)
    if (isDuplicate) {
      setWebPageUrlError('This URL has already been added')
      return
    }

    addAttachment('webpage', trimmedUrl)
    setIsWebPageDialogOpen(false)
    setWebPageUrl('')
    setWebPageUrlError('')
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData
    const files = Array.from(clipboardData.files)

    // Handle file paste (documents and images from clipboard)
    if (files.length > 0) {
      e.preventDefault() // Prevent default text paste when handling files

      const unsupportedFiles: string[] = []
      const documentsToProcess: File[] = []
      const imagesToProcess: File[] = []

      // Categorize files
      for (const file of files) {
        // For clipboard images without extension (e.g., screenshots), check mime type
        if (file.type.startsWith('image/')) {
          imagesToProcess.push(file)
        } else {
          const fileType = getFileType(file.name)
          if (fileType === 'document') {
            documentsToProcess.push(file)
          } else if (fileType === 'image') {
            imagesToProcess.push(file)
          } else {
            unsupportedFiles.push(file.name || file.type)
          }
        }
      }

      // Show error for unsupported files
      if (unsupportedFiles.length > 0) {
        const fileDesc = unsupportedFiles[0]
        if (unsupportedFiles.length === 1) {
          toast.error(`Unsupported file format: ${fileDesc}`, {
            description:
              'Supported: documents (.md, .txt, .json, .js, .ts, etc.) and images (.png, .jpg, .gif, .webp)',
          })
        } else {
          toast.error(`${unsupportedFiles.length} unsupported files`, {
            description: `Including: ${unsupportedFiles.slice(0, 3).join(', ')}${unsupportedFiles.length > 3 ? '...' : ''}`,
          })
        }
      }

      // Process documents
      for (const file of documentsToProcess) {
        try {
          const content = await file.text()
          const newAttachment: Attachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'file',
            name: file.name,
            content,
            mimeType: getMimeType(file.name),
            size: content.length,
          }
          setAttachments((prev) => [...prev, newAttachment])
        } catch (error) {
          console.error('Failed to read pasted file:', file.name, error)
          toast.error(`Failed to read: ${file.name}`)
        }
      }

      // Process images
      for (const file of imagesToProcess) {
        try {
          const arrayBuffer = await file.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          )

          // Generate filename for clipboard images without name
          let fileName = file.name
          if (!fileName || fileName === 'image.png' || fileName === 'blob') {
            const ext = file.type.split('/')[1] || 'png'
            fileName = `clipboard-${Date.now()}.${ext}`
          }

          const mimeType = file.type || getImageMimeType(fileName)

          const newAttachment: Attachment = {
            id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'image',
            name: fileName,
            base64: `data:${mimeType};base64,${base64}`,
            mimeType,
            size: file.size,
          }
          setAttachments((prev) => [...prev, newAttachment])
        } catch (error) {
          console.error('Failed to read pasted image:', file.name, error)
          toast.error(`Failed to read image: ${file.name || 'clipboard image'}`)
        }
      }

      return // Don't process as text if we handled files
    }

    // Handle text paste (URL detection)
    const pastedText = clipboardData.getData('text')
    const urls = pastedText.match(urlRegex)

    if (urls && urls.length > 0) {
      const newAttachments: Attachment[] = []
      urls.forEach((url) => {
        const isDuplicate =
          attachments.some((att) => att.type === 'webpage' && att.name === url) ||
          newAttachments.some((att) => att.name === url)

        if (!isDuplicate) {
          newAttachments.push({
            id: `webpage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'webpage',
            name: url,
          })
        }
      })

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments])
      }
    }
  }

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const unsupportedFiles: string[] = []
    const documentsToProcess: File[] = []
    const imagesToProcess: File[] = []

    // Categorize files
    for (const file of files) {
      const fileType = getFileType(file.name)
      if (fileType === 'document') {
        documentsToProcess.push(file)
      } else if (fileType === 'image') {
        imagesToProcess.push(file)
      } else {
        unsupportedFiles.push(file.name)
      }
    }

    // Show error for unsupported files
    if (unsupportedFiles.length > 0) {
      const ext = unsupportedFiles[0].split('.').pop()?.toLowerCase() || 'unknown'
      if (unsupportedFiles.length === 1) {
        toast.error(`Unsupported file format: .${ext}`, {
          description:
            'Supported: documents (.md, .txt, .json, .js, .ts, etc.) and images (.png, .jpg, .gif, .webp)',
        })
      } else {
        toast.error(`${unsupportedFiles.length} unsupported files`, {
          description: `Including: ${unsupportedFiles.slice(0, 3).join(', ')}${unsupportedFiles.length > 3 ? '...' : ''}`,
        })
      }
    }

    // Process documents
    for (const file of documentsToProcess) {
      try {
        const content = await file.text()
        const newAttachment: Attachment = {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'file',
          name: file.name,
          content,
          mimeType: getMimeType(file.name),
          size: content.length,
        }
        setAttachments((prev) => [...prev, newAttachment])
      } catch (error) {
        console.error('Failed to read file:', file.name, error)
        toast.error(`Failed to read: ${file.name}`)
      }
    }

    // Process images
    for (const file of imagesToProcess) {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        const mimeType = getImageMimeType(file.name)

        const newAttachment: Attachment = {
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'image',
          name: file.name,
          base64: `data:${mimeType};base64,${base64}`,
          mimeType,
          size: file.size,
        }
        setAttachments((prev) => [...prev, newAttachment])
      } catch (error) {
        console.error('Failed to read image:', file.name, error)
        toast.error(`Failed to read image: ${file.name}`)
      }
    }
  }, [])

  const handleSend = async () => {
    console.log('handleSend called', {
      input: input.trim(),
      hasCurrentConversation: !!currentConversation,
      selectedModel: selectedModel?.name,
      selectedAssistant: selectedAssistant?.name,
    })

    if (!input.trim()) {
      console.warn('Cannot send: empty input')
      return
    }

    // Check if we have either a model or assistant selected
    if (!selectedModel && !selectedAssistant) {
      alert('Please select a model or assistant first')
      return
    }

    // Determine which model to use
    let modelToUse: Model | undefined
    let providerType: string
    let modelIdStr: string

    if (selectedAssistant) {
      // Use assistant's model
      modelToUse = getModelById(selectedAssistant.model_id)
      if (!modelToUse) {
        console.error('Model not found for assistant:', selectedAssistant.model_id)
        alert('Error: Model configuration not found for assistant')
        return
      }
    } else if (selectedModel) {
      // Use selected model directly
      modelToUse = selectedModel
    } else {
      alert('Please select a model or assistant first')
      return
    }

    // Get provider info
    const provider = getProviderById(modelToUse.provider_id)
    if (!provider) {
      console.error('Provider not found for model:', modelToUse.provider_id)
      alert('Error: Provider configuration not found')
      return
    }

    providerType = provider.provider_type
    modelIdStr = modelToUse.model_id

    const content = input.trim()
    setInput('')

    try {
      // Get API credentials from provider
      const apiKey: string | undefined = provider.api_key
      const baseUrl: string | undefined = provider.base_url

      // Get prompts from assistant if selected
      let systemPrompt: string | undefined
      let userPrompt: string | undefined

      if (selectedAssistant) {
        systemPrompt = selectedAssistant.system_prompt
        userPrompt = selectedAssistant.user_prompt || undefined
        console.log('Using assistant prompts:', {
          hasSystemPrompt: !!systemPrompt,
          hasUserPrompt: !!userPrompt,
        })
      }

      // Extract file attachments as structured data (sent via rig's Document)
      const fileAttachments = attachments.filter((att) => att.type === 'file' && att.content)
      const files = fileAttachments.map((file) => ({
        name: file.name,
        content: file.content!,
        mimeType: file.mimeType || 'text/plain',
      }))

      // Extract image attachments with filename
      const imageAttachments = attachments.filter((att) => att.type === 'image' && att.base64)
      const images = imageAttachments.map((img) => ({
        name: img.name,
        base64: img.base64!,
        mimeType: img.mimeType || 'image/png',
      }))

      console.log('Sending message:', {
        content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        conversationId: currentConversation?.id,
        provider: providerType,
        model: modelIdStr,
        hasApiKey: !!apiKey,
        baseUrl,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        modelDbId: selectedAssistant ? undefined : modelToUse.id,
        assistantDbId: selectedAssistant?.id,
        selectedAssistant: selectedAssistant?.name,
        selectedModel: selectedModel?.name,
        modelToUse: modelToUse?.name,
        fileAttachmentsCount: files.length,
        imagesCount: images.length,
      })

      // Extract webpage URLs from attachments
      const webpageUrls = attachments.filter((att) => att.type === 'webpage').map((att) => att.name)

      await sendMessage(
        content, // Send original content, files are sent separately
        currentConversation?.id ?? null,
        providerType,
        modelIdStr,
        apiKey,
        baseUrl,
        undefined, // includeHistory
        systemPrompt,
        userPrompt,
        selectedAssistant ? undefined : modelToUse.id, // modelDbId - only send if not using assistant
        selectedAssistant?.id, // assistantDbId
        webpageUrls.length > 0 ? webpageUrls : undefined, // urlsToFetch
        images.length > 0 ? images : undefined, // images
        files.length > 0 ? files : undefined, // files
        webSearchEnabled // searchEnabled
      )

      // Clear attachments after sending
      setAttachments([])

      console.log('Message sent successfully')
    } catch (error) {
      console.error('Failed to send message:', error)
      alert(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStop = async () => {
    if (!currentConversation) {
      console.warn('Cannot stop: no current conversation')
      return
    }

    console.log('handleStop called for conversation:', currentConversation.id)

    try {
      await stopGeneration(currentConversation.id)
      console.log('Generation stopped successfully')
    } catch (error) {
      console.error('Failed to stop generation:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition keys have keyCode 229
    // This is the most reliable way to detect IME input
    if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
      return // Let IME handle the input
    }

    // Command+Enter or Ctrl+Enter: insert new line manually
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = input.substring(0, start) + '\n' + input.substring(end)
      setInput(newValue)

      // Set cursor position after the inserted newline
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1
      }, 0)
      return
    }

    // Enter without modifiers: send message
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleModelSelect = (modelId: string) => {
    console.log('handleModelSelect called with modelId:', modelId)
    const model = getModelById(modelId)
    if (!model) {
      console.error('Model not found:', modelId)
      return
    }

    // Simply set the selected model
    setSelectedModel(model)
    console.log('Selected model:', model.name)

    // Close the dropdown menu
    setIsModelMenuOpen(false)
  }

  const handleAssistantSelect = (assistantId: string) => {
    console.log('handleAssistantSelect called with assistantId:', assistantId)
    const assistant = assistants.find((a) => a.id === assistantId)
    if (!assistant) {
      console.error('Assistant not found:', assistantId)
      return
    }

    // Set the selected assistant (this will clear model selection automatically)
    setSelectedAssistant(assistant)
    console.log('Selected assistant:', assistant.name)

    // Close the dropdown menu
    setIsModelMenuOpen(false)
  }

  const handleModelStarToggle = async (model: ModelListModel) => {
    console.log('Toggle star for model:', model)
    // Find the real model from store
    const realModel = models.find((m) => m.id === model.id)
    if (realModel) {
      try {
        await updateModel(realModel.id, {
          name: realModel.name,
          provider_id: realModel.provider_id,
          model_id: realModel.model_id,
          description: realModel.description,
          is_starred: !realModel.is_starred,
        })
      } catch (error) {
        console.error('Failed to toggle star:', error)
      }
    }
  }

  const handleAssistantStarToggle = async (assistant: AssistantListAssistant) => {
    console.log('Toggle star for assistant:', assistant)
    // Find the real assistant from store
    const realAssistant = assistants.find((a) => a.id === assistant.id)
    if (realAssistant) {
      try {
        await updateAssistant(realAssistant.id, {
          name: realAssistant.name,
          system_prompt: realAssistant.system_prompt,
          model_id: realAssistant.model_id,
          avatar_bg: realAssistant.avatar_bg,
          avatar_text: realAssistant.avatar_text,
          is_starred: !realAssistant.is_starred,
        })
      } catch (error) {
        console.error('Failed to toggle star:', error)
      }
    }
  }

  // Get display text for current selection
  const getSelectionDisplay = () => {
    if (selectedAssistant) {
      const model = getModelById(selectedAssistant.model_id)
      return model ? `${selectedAssistant.name} - ${model.name}` : selectedAssistant.name
    } else if (selectedModel) {
      const provider = getProviderById(selectedModel.provider_id)
      return provider ? `${selectedModel.name} - ${provider.name}` : selectedModel.name
    } else {
      return 'Select model or assistant'
    }
  }

  // Transform models to ModelVendor groups
  const modelVendors = useMemo((): ModelVendor[] => {
    const vendorMap = new Map<string, ModelListModel[]>()

    // Filter out soft-deleted models for selection UI
    const activeModels = models.filter((m) => !m.is_deleted)

    activeModels.forEach((model) => {
      const provider = getProviderById(model.provider_id)
      if (!provider) return

      const vendorKey = provider.id
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, [])
      }

      vendorMap.get(vendorKey)!.push({
        id: model.id,
        name: model.name,
        modelId: model.model_id,
        providerName: provider.name,
        isStarred: model.is_starred,
      })
    })

    return Array.from(vendorMap.entries()).map(([vendorId, models]) => {
      const provider = getProviderById(vendorId)
      return {
        id: vendorId,
        name: provider?.name || 'Unknown',
        models,
      }
    })
  }, [models, getProviderById])

  // Transform assistants to AssistantGroup groups
  const assistantGroups = useMemo((): AssistantGroup[] => {
    const groupMap = new Map<string, AssistantListAssistant[]>()

    assistants.forEach((assistant) => {
      const groupName = assistant.group_name || 'Default'
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
      }

      const model = getModelById(assistant.model_id)

      groupMap.get(groupName)!.push({
        id: assistant.id,
        name: assistant.name,
        persona: assistant.role,
        modelName: model?.name,
        logo: assistant.avatar_image_url,
        avatarBg: assistant.avatar_bg,
        avatarText: assistant.avatar_text,
        isStarred: assistant.is_starred,
      })
    })

    return Array.from(groupMap.entries()).map(([groupName, assistants]) => ({
      id: groupName.toLowerCase().replace(/\s+/g, '-'),
      name: groupName,
      assistants,
    }))
  }, [assistants, getModelById])

  return (
    <div
      ref={dropZoneRef}
      className="grid w-full gap-6 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop zone overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="size-8" />
            <span className="text-sm font-medium">Drop files here</span>
            <span className="text-xs text-muted-foreground">Documents or Images</span>
          </div>
        </div>
      )}
      {/* Get all image attachments for lightbox navigation */}
      {(() => {
        const imageAttachments = attachments.filter((att) => att.type === 'image' && att.base64)
        const lightboxImages: ImageAttachmentData[] = imageAttachments.map((img) => ({
          id: img.id,
          fileName: img.name,
          base64: img.base64!,
        }))

        // Get previewing file attachment
        const previewingFile = previewingFileId
          ? attachments.find((att) => att.id === previewingFileId && att.type === 'file')
          : null

        return (
          <>
            {/* Lightbox for images - reuses shared component */}
            {lightboxImageIndex !== null && lightboxImages.length > 0 && (
              <ImageLightbox
                images={lightboxImages}
                initialIndex={lightboxImageIndex}
                onClose={() => setLightboxImageIndex(null)}
              />
            )}

            {/* File preview dialog - reuses shared component */}
            {previewingFile && previewingFile.content && (
              <FilePreviewDialog
                isOpen={true}
                onClose={() => setPreviewingFileId(null)}
                fileName={previewingFile.name}
                content={previewingFile.content}
                mimeType={previewingFile.mimeType}
                size={previewingFile.size}
              />
            )}
          </>
        )
      })()}

      <InputGroup>
        {attachments.length > 0 && (
          <div className="order-first w-full flex flex-wrap gap-2 px-3 pt-3 pb-0">
            {attachments.map((attachment, _index) => {
              // Get image index for lightbox navigation
              const imageAttachments = attachments.filter(
                (att) => att.type === 'image' && att.base64
              )
              const imageIndex =
                attachment.type === 'image'
                  ? imageAttachments.findIndex((img) => img.id === attachment.id)
                  : -1

              const handlePreviewClick = () => {
                if (attachment.type === 'image' && attachment.base64) {
                  // Open lightbox at the correct index
                  setLightboxImageIndex(imageIndex)
                } else if (attachment.type === 'file' && attachment.content) {
                  // Open file preview dialog
                  setPreviewingFileId(attachment.id)
                }
              }

              const isPreviewable =
                (attachment.type === 'image' && attachment.base64) ||
                (attachment.type === 'file' && attachment.content)

              return (
                <Badge
                  key={attachment.id}
                  variant="outline"
                  className="hover:bg-accent transition-colors text-muted-foreground hover:text-foreground gap-1.5"
                >
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="hover:text-destructive transition-colors -ml-0.5"
                  >
                    <X className="size-3" />
                  </button>
                  {isPreviewable ? (
                    <button
                      type="button"
                      onClick={handlePreviewClick}
                      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
                    >
                      {attachment.type === 'image' && attachment.base64 ? (
                        <img
                          src={attachment.base64}
                          alt={attachment.name}
                          className="h-4 w-4 object-cover rounded"
                        />
                      ) : (
                        getAttachmentIcon(attachment.type)
                      )}
                      <span className="max-w-[150px] truncate">{attachment.name}</span>
                      {attachment.size !== undefined && (
                        <span className="text-xs opacity-60">
                          ({formatFileSize(attachment.size)})
                        </span>
                      )}
                    </button>
                  ) : (
                    <>
                      {attachment.type === 'image' && attachment.base64 ? (
                        <img
                          src={attachment.base64}
                          alt={attachment.name}
                          className="h-4 w-4 object-cover rounded"
                        />
                      ) : (
                        getAttachmentIcon(attachment.type)
                      )}
                      {attachment.type === 'webpage' ? (
                        <button
                          type="button"
                          onClick={() => openUrl(attachment.name)}
                          className="hover:underline cursor-pointer"
                        >
                          {attachment.name}
                        </button>
                      ) : (
                        <span className="max-w-[150px] truncate">{attachment.name}</span>
                      )}
                      {attachment.size !== undefined && (
                        <span className="text-xs opacity-60">
                          ({formatFileSize(attachment.size)})
                        </span>
                      )}
                    </>
                  )}
                </Badge>
              )
            })}
          </div>
        )}
        <InputGroupTextarea
          ref={textareaRef}
          placeholder="Ask, Search or Chat..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={!selectedModel && !selectedAssistant}
        />
        <InputGroupAddon align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="outline" className="rounded-full" size="icon-xs">
                <Plus />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="[--radius:0.95rem]">
              <DropdownMenuItem onClick={handleWebPageSelect} className="gap-2">
                <Globe className="size-4" />
                <span>Web Page</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFileSelect} className="gap-2">
                <FileText className="size-4" />
                <span>Document</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImageSelect} className="gap-2">
                <Image className="size-4" />
                <span>Image</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="outline" className="rounded-full" size="icon-xs">
                <Settings2 />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem] min-w-[180px]"
            >
              <DropdownMenuItem
                className="gap-2 justify-between"
                onSelect={(e) => e.preventDefault()}
              >
                <div className="flex items-center gap-2">
                  <Search className="size-4" />
                  <span>Web Search</span>
                </div>
                <Switch checked={webSearchEnabled} onCheckedChange={setWebSearchEnabled} />
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 justify-between"
                onSelect={(e) => e.preventDefault()}
              >
                <div className="flex items-center gap-2">
                  <Package className="size-4" />
                  <span>Artifacts</span>
                </div>
                <Switch checked={artifactsEnabled} onCheckedChange={setArtifactsEnabled} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePromptSelect} className="gap-2">
                <Sparkles className="size-4" />
                <span>Prompt</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleKnowledgeBaseSelect} className="gap-2">
                <BookOpen className="size-4" />
                <span>Knowledge</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToolSelect} className="gap-2">
                <Plug className="size-4" />
                <span>Tools</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu open={isModelMenuOpen} onOpenChange={setIsModelMenuOpen}>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost" className="gap-2">
                {(() => {
                  if (selectedAssistant) {
                    // For assistants, show their avatar (custom image or text/emoji with background)
                    const hasCustomImage =
                      selectedAssistant.avatar_type === 'image' &&
                      (selectedAssistant.avatar_image_url || selectedAssistant.avatar_image_path)
                    const avatarBg = selectedAssistant.avatar_bg || '#3b82f6'
                    const isHexColor = avatarBg.startsWith('#')
                    const avatarStyle = isHexColor ? { backgroundColor: avatarBg } : undefined
                    const avatarClassName = !isHexColor ? avatarBg : undefined

                    return (
                      <>
                        <Avatar
                          key={`assistant-${selectedAssistant.id}`}
                          className={cn('h-4 w-4', avatarClassName)}
                          style={avatarStyle}
                        >
                          {hasCustomImage && (
                            <AvatarImage
                              src={
                                selectedAssistant.avatar_image_url ||
                                selectedAssistant.avatar_image_path
                              }
                              alt={selectedAssistant.name}
                            />
                          )}
                          <AvatarFallback
                            className={cn('text-white text-[8px]', avatarClassName)}
                            style={avatarStyle}
                          >
                            {selectedAssistant.avatar_text ||
                              selectedAssistant.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{getSelectionDisplay()}</span>
                      </>
                    )
                  } else if (selectedModel) {
                    // For models, show model logo with first character fallback
                    const modelLogo = getModelLogo(selectedModel)

                    return (
                      <>
                        <Avatar key={`model-${selectedModel.id}`} className="size-4">
                          {modelLogo && <AvatarImage src={modelLogo} alt={selectedModel.name} />}
                          <AvatarFallback className="text-[10px]">
                            {selectedModel.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{getSelectionDisplay()}</span>
                      </>
                    )
                  } else {
                    return <span className="text-xs">{getSelectionDisplay()}</span>
                  }
                })()}
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="[--radius:0.95rem] p-2 w-[320px] max-h-[400px] overflow-y-auto"
            >
              <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as 'models' | 'assistants')}
              >
                <TabsList className="grid w-full grid-cols-2 mb-2">
                  <TabsTrigger value="models" className="text-xs">
                    Models
                  </TabsTrigger>
                  <TabsTrigger value="assistants" className="text-xs">
                    Assistants
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="models" className="mt-0">
                  {modelVendors.length > 0 ? (
                    <ModelList
                      vendors={modelVendors}
                      selectedModelId={selectedModel?.id}
                      onModelClick={(model) => handleModelSelect(model.id)}
                      onModelStarToggle={handleModelStarToggle}
                      compact={true}
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No models available
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="assistants" className="mt-0">
                  {assistantGroups.length > 0 ? (
                    <AssistantList
                      groups={assistantGroups}
                      selectedAssistantId={selectedAssistant?.id}
                      onAssistantClick={(assistant) => handleAssistantSelect(assistant.id)}
                      onAssistantStarToggle={handleAssistantStarToggle}
                      compact={true}
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                      No assistants available
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-1.5">
            {/* <CircleProgress percentage={56} size={20} />
            <span className="text-xs text-muted-foreground">56.0%</span> */}
          </div>
          <Separator orientation="vertical" className="!h-4" />
          {isStreaming || isWaitingForAI ? (
            <InputGroupButton
              variant="default"
              className="rounded-full"
              size="icon-xs"
              onClick={handleStop}
            >
              <Square className="size-3 fill-current" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              className="rounded-full"
              size="icon-xs"
              disabled={!input.trim() || (!selectedModel && !selectedAssistant) || isSending}
              onClick={handleSend}
            >
              <ArrowUpIcon />
              <span className="sr-only">Send</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>

      {/* Web Page URL Dialog */}
      <Dialog open={isWebPageDialogOpen} onOpenChange={setIsWebPageDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link className="size-5" />
              Add Web Page
            </DialogTitle>
            <DialogDescription>
              Enter a URL to attach web page content to your message.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              placeholder="https://example.com"
              value={webPageUrl}
              onChange={(e) => {
                setWebPageUrl(e.target.value)
                setWebPageUrlError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleWebPageUrlSubmit()
                }
              }}
              aria-invalid={!!webPageUrlError}
              autoFocus
            />
            {webPageUrlError && <p className="text-sm text-destructive">{webPageUrlError}</p>}
          </div>
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setIsWebPageDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleWebPageUrlSubmit}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
