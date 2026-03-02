import { useCallback, type RefObject } from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { saveScreenshot, findMessageElement } from '@/lib/screenshot'

interface UseMessageHandlersOptions {
  messagesEndRef: RefObject<HTMLDivElement | null>
  messagesContentRef: RefObject<HTMLDivElement | null>
  setIsAtBottom: (value: boolean) => void
}

export function useMessageHandlers({
  messagesEndRef,
  messagesContentRef,
  setIsAtBottom,
}: UseMessageHandlersOptions) {
  const handleCopy = useCallback(() => {
    logger.info('Message copied')
  }, [])

  const handleResend = useCallback(() => {
    logger.info('Resend message')
  }, [])

  const handleTranslate = useCallback(() => {
    logger.info('Translate message')
  }, [])

  const handleExportAll = useCallback(() => {
    const el = messagesContentRef.current
    if (!el) {
      toast.error('No messages to capture')
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success('Screenshot saved')
    })
  }, [messagesContentRef])

  const handleExportConversation = useCallback(() => {
    const el = messagesContentRef.current
    if (!el) {
      toast.error('No messages to capture')
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success('Screenshot saved')
    })
  }, [messagesContentRef])

  const handleExportMessage = useCallback((messageId: string) => {
    const el = findMessageElement(messageId)
    if (!el) {
      toast.error('Could not find message element')
      return
    }
    saveScreenshot(el).then((ok) => {
      if (ok) toast.success('Screenshot saved')
    })
  }, [])

  const handleScrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsAtBottom(true)
  }, [messagesEndRef, setIsAtBottom])

  return {
    handleCopy,
    handleResend,
    handleTranslate,
    handleExportAll,
    handleExportConversation,
    handleExportMessage,
    handleScrollToBottom,
  }
}
