import { useRef, useState, useEffect, useCallback, RefObject } from 'react'

interface UseScrollBehaviorOptions {
  messagesLength: number
  streamingContent: string
  streamingReasoningContent: string
  isStreaming: boolean
  isWaitingForAI: boolean
  conversationId: string | null
}

interface UseScrollBehaviorReturn {
  messagesEndRef: RefObject<HTMLDivElement | null>
  messagesContainerRef: RefObject<HTMLDivElement | null>
  messagesContentRef: RefObject<HTMLDivElement | null>
  isAtBottom: boolean
  setIsAtBottom: (value: boolean) => void
  buttonLeft: string | number
  handleScroll: () => void
}

export function useScrollBehavior({
  messagesLength,
  streamingContent,
  streamingReasoningContent,
  isStreaming,
  isWaitingForAI,
  conversationId,
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)

  // Track if user is at bottom
  const [isAtBottom, setIsAtBottom] = useState(true)

  // Track messages content container position for button centering
  const [buttonLeft, setButtonLeft] = useState<string | number>('50%')

  // Track if user is actively scrolling (user scroll lock)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number | null>(null)

  // Check if user is near bottom (within 100px threshold)
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true

    const threshold = 100
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold

    return isNearBottom
  }, [])

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    // Mark that user is actively scrolling
    isUserScrollingRef.current = true

    // Clear any existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Set a timeout to mark scroll as finished (user stopped scrolling)
    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false
      // Update position only after user stops scrolling
      setIsAtBottom(checkIfAtBottom())
    }, 150) // 150ms debounce - adjust if needed
  }, [checkIfAtBottom])

  // Calculate button position based on messages content container
  useEffect(() => {
    const updateButtonPosition = () => {
      const messagesContent = messagesContentRef.current
      if (!messagesContent) {
        setButtonLeft('50%')
        return
      }

      const rect = messagesContent.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      setButtonLeft(centerX)
    }

    updateButtonPosition()

    // Update on window resize
    window.addEventListener('resize', updateButtonPosition)
    // Update on scroll (in case layout shifts)
    const container = messagesContainerRef.current
    if (container) {
      container.addEventListener('scroll', updateButtonPosition)
    }

    return () => {
      window.removeEventListener('resize', updateButtonPosition)
      if (container) {
        container.removeEventListener('scroll', updateButtonPosition)
      }
    }
  }, [messagesLength, isAtBottom])

  // Auto-scroll to bottom ONLY if user is at bottom AND not actively scrolling
  useEffect(() => {
    // Don't auto-scroll if user is actively scrolling
    if (isUserScrollingRef.current) {
      return
    }

    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messagesLength, streamingContent, streamingReasoningContent, isStreaming, isWaitingForAI, isAtBottom])

  // Reset to bottom when conversation changes
  useEffect(() => {
    if (conversationId) {
      setIsAtBottom(true)
      isUserScrollingRef.current = false
    }
  }, [conversationId])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  return {
    messagesEndRef,
    messagesContainerRef,
    messagesContentRef,
    isAtBottom,
    setIsAtBottom,
    buttonLeft,
    handleScroll,
  }
}
