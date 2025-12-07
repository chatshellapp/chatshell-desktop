import { useState, useCallback, useRef } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import {
  type Attachment,
  type AttachmentType,
  getMimeType,
  getImageMimeType,
  getFileType,
  URL_REGEX,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from './types'

export interface UseAttachmentsReturn {
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  addAttachment: (type: AttachmentType, name: string) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void
  handleFileSelect: () => Promise<void>
  handleImageSelect: () => Promise<void>
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>
  // Drag and drop
  isDraggingOver: boolean
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => Promise<void>
  }
}

export function useAttachments(): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)

  const addAttachment = useCallback((type: AttachmentType, name: string) => {
    const newAttachment: Attachment = {
      id: `${type}-${Date.now()}`,
      type,
      name,
    }
    setAttachments((prev) => [...prev, newAttachment])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments([])
  }, [])

  const handleFileSelect = useCallback(async () => {
    try {
      console.log('[handleFileSelect] Opening file dialog...')
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Documents',
            extensions: SUPPORTED_DOCUMENT_EXTENSIONS,
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
        console.log('[handleFileSelect] Created attachment:', newAttachment.name, newAttachment.size)
        setAttachments((prev) => {
          console.log('[handleFileSelect] Updating attachments, prev count:', prev.length)
          return [...prev, newAttachment]
        })
      }
      console.log('[handleFileSelect] Done processing files')
    } catch (error) {
      console.error('[handleFileSelect] Failed to select file:', error)
    }
  }, [])

  const handleImageSelect = useCallback(async () => {
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
  }, [])

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
              new Uint8Array(arrayBuffer).reduce(
                (data, byte) => data + String.fromCharCode(byte),
                ''
              )
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
      const urls = pastedText.match(URL_REGEX)

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
    },
    [attachments]
  )

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

  return {
    attachments,
    setAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    handleFileSelect,
    handleImageSelect,
    handlePaste,
    isDraggingOver,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  }
}

