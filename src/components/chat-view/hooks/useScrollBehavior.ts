import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useMessageStore } from '@/stores/message'

/** User scrolled within this distance of the top: ask for an older page. */
const LOAD_EARLIER_TRIGGER_PX = 200

/** Frames a conversation switch keeps pinning the viewport to the bottom.
 * Covers progressive row mounting (~7 frames for a 100-row window) plus
 * late height growth from async code highlighting and image decode. */
const OPEN_SETTLE_FRAMES = 30
/** Frames an appended message keeps re-pinning (short settle). */
const APPEND_SETTLE_FRAMES = 6

interface UseScrollBehaviorOptions {
  messagesLength: number
  conversationId: string | null
  /** Called (synchronously, throttled by the caller's in-flight guard) when
   * the user scrolls near the top of the loaded window. */
  onNearTop?: () => void
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

/**
 * Scroll plumbing for the chat view.
 *
 * Render-frequency contract:
 * - No React state depends on streaming content. Streaming follow-along is
 *   driven by a raw store subscription that writes `scrollTop` directly
 *   inside requestAnimationFrame, so per-token updates never re-render the
 *   view and never restart a smooth-scroll animation.
 * - The button position is recomputed on resize (window + content element
 *   via ResizeObserver), not on every scroll event, so scrolling a long DOM
 *   does not force a layout read per frame.
 *
 * Programmatic-scroll contract: our own `scrollTop` writes also fire scroll
 * events. Without the self-scroll guard those events masquerade as user
 * input — locking follow-along for 150ms after every write and re-triggering
 * upward paging. `pinToBottom` marks each write so `handleScroll` can tell
 * them apart; a real wheel/touch event lands outside the 2-frame mark window
 * and is classified normally.
 */
export function useScrollBehavior({
  messagesLength,
  conversationId,
  onNearTop,
}: UseScrollBehaviorOptions): UseScrollBehaviorReturn {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)

  // Track if user is at bottom. Mirrored into a ref so the store
  // subscription below can read the live value without re-subscribing.
  const [isAtBottom, setIsAtBottomState] = useState(true)
  const isAtBottomRef = useRef(true)
  const setIsAtBottom = useCallback((value: boolean) => {
    isAtBottomRef.current = value
    setIsAtBottomState(value)
  }, [])

  // Track messages content container position for button centering
  const [buttonLeft, setButtonLeft] = useState<string | number>('50%')

  // Track if user is actively scrolling (user scroll lock)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number | null>(null)

  // True while a scroll event originated from our own write
  const selfScrollRef = useRef(false)

  // Keep the near-top callback reachable without effect churn
  const onNearTopRef = useRef(onNearTop)
  useEffect(() => {
    onNearTopRef.current = onNearTop
  }, [onNearTop])

  const pinToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    selfScrollRef.current = true
    container.scrollTop = container.scrollHeight
    // Scroll events for this write dispatch before the next frames clear it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        selfScrollRef.current = false
      })
    })
  }, [])

  /**
   * Keep the viewport at the bottom for the next `frames` animation frames,
   * re-pinning each frame so content growth above the viewport (progressive
   * row mounting, async highlighting, image decode) cannot strand the view
   * mid-list. Yields immediately once the user scrolls away — the debounced
   * bottom check flips `isAtBottomRef` within 150ms of real user input.
   */
  const settleToBottom = useCallback(
    (frames: number) => {
      let raf = 0
      let left = frames
      const step = () => {
        if (isUserScrollingRef.current || !isAtBottomRef.current) return
        pinToBottom()
        left -= 1
        if (left > 0) raf = requestAnimationFrame(step)
      }
      step()
      return () => cancelAnimationFrame(raf)
    },
    [pinToBottom]
  )

  // Handle scroll events: debounce bottom detection, trigger upward paging
  // immediately (the store's in-flight flag throttles the actual loads).
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // Our own programmatic writes also fire scroll events; they are not user
    // input (no user-scroll lock, no paging trigger).
    if (!selfScrollRef.current) {
      if (container.scrollTop < LOAD_EARLIER_TRIGGER_PX) {
        onNearTopRef.current?.()
      }
      isUserScrollingRef.current = true
    }

    clearTimeout(scrollTimeoutRef.current ?? undefined)
    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false
      // Update position only after user stops scrolling
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      setIsAtBottom(nearBottom)
    }, 150) // 150ms debounce - adjust if needed
  }, [setIsAtBottom])

  // Calculate button position from the content container. Width-driven only:
  // ResizeObserver fires per streaming token (height changes), so gate on the
  // observed width to avoid pointless state writes.
  useEffect(() => {
    const messagesContent = messagesContentRef.current
    if (!messagesContent) {
      setButtonLeft('50%')
      return
    }

    let lastWidth: number | null = null
    const updateButtonPosition = (width?: number) => {
      if (width !== undefined) {
        if (lastWidth === width) return
        lastWidth = width
      }
      const rect = messagesContent.getBoundingClientRect()
      lastWidth = rect.width
      setButtonLeft(rect.left + rect.width / 2)
    }

    updateButtonPosition()

    const onResize = () => updateButtonPosition()
    window.addEventListener('resize', onResize)

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateButtonPosition(entry.contentRect.width)
      }
    })
    observer.observe(messagesContent)

    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  }, [messagesLength, isAtBottom])

  // Streaming follow-along without re-renders: every store update while this
  // conversation is streaming/waiting schedules (rAF-deduped) a direct
  // scrollTop write, replacing the old per-token smooth scrollIntoView.
  useEffect(() => {
    if (!conversationId) return
    let rafId: number | null = null

    const followTail = () => {
      rafId = null
      if (isUserScrollingRef.current || !isAtBottomRef.current) return
      pinToBottom()
    }

    const unsubscribe = useMessageStore.subscribe(() => {
      const cs = useMessageStore.getState().conversationStates[conversationId]
      if (!cs?.isStreaming && !cs?.isWaitingForAI) return
      if (rafId === null) rafId = requestAnimationFrame(followTail)
    })

    return () => {
      unsubscribe()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [conversationId, pinToBottom])

  // Conversation switched (or first opened): assume follow-mode and keep
  // pinning for a short settle window. Without per-frame re-pinning, content
  // that grows after the first write (rows mounting progressively above the
  // viewport, async highlighting) leaves the view stranded mid-list.
  useEffect(() => {
    setIsAtBottom(true)
    return settleToBottom(OPEN_SETTLE_FRAMES)
  }, [conversationId, settleToBottom])

  // New message appended (user sent / assistant finalized): re-pin briefly
  // if following. The settle loop self-gates on isAtBottom.
  useEffect(() => {
    if (isUserScrollingRef.current) return
    return settleToBottom(APPEND_SETTLE_FRAMES)
  }, [messagesLength, settleToBottom])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeout(scrollTimeoutRef.current ?? undefined)
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
