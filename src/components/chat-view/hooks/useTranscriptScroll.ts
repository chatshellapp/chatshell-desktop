import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Message } from '@/types'
import {
  requestTranscriptScroll,
  subscribeTranscriptScroll,
  type TranscriptScrollRequest,
} from '@/lib/transcript-scroll'

/** User scrolled within this distance of the top: ask for an older page. */
const LOAD_EARLIER_TRIGGER_PX = 200
/** Breathing room above a row placed at the top of the viewport. */
export const TOP_INSET_PX = 16
/** The end of the transcript is this far below the viewport: offer the jump. */
const JUMP_THRESHOLD_PX = 40
/** A target row that never appears (paged out, deleted) is given up on. */
const TARGET_TIMEOUT_MS = 3000
/** Anchor re-application pauses while a smooth programmatic scroll runs. */
const SMOOTH_SCROLL_MS = 600
/** Longest the opening position stays hidden while it settles. */
const SETTLE_MAX_FRAMES = 12
/** Keys that scroll the transcript when it has focus. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/** The row the reader is looking at and its distance from the viewport top. */
interface Anchor {
  id: string
  offset: number
}

type ResolvedPlacement =
  | { kind: 'initial' }
  | { kind: 'top' }
  | { kind: 'center' }
  | { kind: 'offset'; offset: number }
  | { kind: 'end' }

interface Target {
  messageId?: string
  placement: ResolvedPlacement
  smooth: boolean
  deadline: number
}

interface UseTranscriptScrollOptions {
  conversationId: string | null
  /** The loaded window; the initial intent and the last-turn floor read it. */
  messages: Message[]
  /** Called when the user scrolls near the top of the loaded window. */
  onNearTop?: () => void
}

export interface UseTranscriptScrollReturn {
  containerRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  /** Spacer after the last turn; sized so the last user message can reach
   * the top of the viewport even when the reply below it is short. */
  floorRef: RefObject<HTMLDivElement | null>
  handleScroll: () => void
  showJumpToLatest: boolean
  jumpToLatest: () => void
  buttonLeft: string | number
}

function lastTurnStartId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_type === 'user') return messages[i].id
  }
  return null
}

/**
 * Explicit scroll model for the transcript.
 *
 * Only intents move the viewport: opening a conversation (last user message
 * at the top), a direct send, jump-to-latest, search and branch switches
 * (via `requestTranscriptScroll`). Everything else holds the reader's top
 * row in place: every scroll records an anchor (topmost visible row + its
 * offset), and every layout change re-applies it before paint. Growth above
 * the anchor (upward paging, progressive mounting, rows rendering at their
 * real height) therefore never shifts what the reader sees, and streaming
 * growth below it never moves the viewport at all.
 */
export function useTranscriptScroll({
  conversationId,
  messages,
  onNearTop,
}: UseTranscriptScrollOptions): UseTranscriptScrollReturn {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const floorRef = useRef<HTMLDivElement>(null)

  const messagesRef = useRef(messages)
  const onNearTopRef = useRef(onNearTop)
  useEffect(() => {
    onNearTopRef.current = onNearTop
  }, [onNearTop])

  const anchorRef = useRef<Anchor | null>(null)
  const targetRef = useRef<Target | null>(null)
  // The scrollTop our last write produced, until its scroll event arrives.
  // A scroll event is ours only if the position still matches: recognizing
  // writes by a time window swallowed reader scrolls landing inside it, and
  // the anchor then snapped the reader back.
  const selfScrollTopRef = useRef<number | null>(null)
  const suspendUntilRef = useRef(0)

  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const showJumpRef = useRef(false)
  const [buttonLeft, setButtonLeft] = useState<string | number>('50%')

  const findRow = useCallback((id: string): HTMLElement | null => {
    return contentRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`) ?? null
  }, [])

  /** Row top in scroll-content coordinates. */
  const rowTop = useCallback((container: HTMLElement, el: HTMLElement) => {
    return (
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    )
  }, [])

  const writeScrollTop = useCallback((value: number) => {
    const container = containerRef.current
    if (!container) return
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    const next = Math.min(Math.max(0, value), max)
    if (Math.abs(next - container.scrollTop) < 0.5) return
    container.scrollTop = next
    // Read back: the browser rounds to device pixels
    selfScrollTopRef.current = container.scrollTop
  }, [])

  /** Anchor on the first row that starts inside the viewport; only when a
   * single row covers the whole viewport, on that row. A row partly above
   * the viewport may still change height (estimated off-screen extent
   * resolving to its real size), which would move everything below it. */
  const recordAnchor = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const rows = content.querySelectorAll<HTMLElement>('[data-message-id]')
    if (rows.length === 0) return
    const viewportTop = container.getBoundingClientRect().top
    const viewportBottom = viewportTop + container.clientHeight
    // Binary search: first row whose top is at or below the viewport top.
    let lo = 0
    let hi = rows.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (rows[mid].getBoundingClientRect().top >= viewportTop - 0.5) hi = mid
      else lo = mid + 1
    }
    let row: HTMLElement | undefined = rows[lo]
    if (!row || row.getBoundingClientRect().top >= viewportBottom) {
      row = lo > 0 ? rows[lo - 1] : undefined
    }
    const id = row?.dataset.messageId
    if (!row || !id) return
    anchorRef.current = { id, offset: row.getBoundingClientRect().top - viewportTop }
  }, [])

  const reapplyAnchor = useCallback(() => {
    const container = containerRef.current
    const anchor = anchorRef.current
    if (!container || !anchor) return
    const el = findRow(anchor.id)
    // A vanished anchor row keeps the current offset.
    if (!el) return
    writeScrollTop(rowTop(container, el) - anchor.offset)
  }, [findRow, rowTop, writeScrollTop])

  const updateFloor = useCallback(() => {
    const container = containerRef.current
    const floor = floorRef.current
    if (!container || !floor) return
    const lastUserId = lastTurnStartId(messagesRef.current)
    const el = lastUserId ? findRow(lastUserId) : null
    let needed = 0
    if (el) {
      // The floor ends the content, so the maximum offset is its top plus its
      // height minus the viewport. Measured from the floor's own top: the
      // content wrapper is at least one viewport tall, so scrollHeight
      // overstates the content when the transcript is short.
      const floorTop = rowTop(container, floor)
      needed = Math.max(
        0,
        Math.ceil(rowTop(container, el) - TOP_INSET_PX + container.clientHeight - floorTop)
      )
    }
    const next = `${needed}px`
    if (floor.style.height !== next) floor.style.height = next
  }, [findRow, rowTop])

  const updateJump = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight
    const show = distance > JUMP_THRESHOLD_PX
    if (show !== showJumpRef.current) {
      showJumpRef.current = show
      setShowJumpToLatest(show)
    }
  }, [])

  // Opening position is confirmed before it is shown: rows skipped as
  // off-screen settle to their real height a frame after they mount, so the
  // first frame with rows can be off. The transcript stays transparent from
  // that frame until the target held its offset for two frames.
  const settleRef = useRef<{ raf: number } | null>(null)
  const reveal = useCallback(() => {
    if (settleRef.current) cancelAnimationFrame(settleRef.current.raf)
    settleRef.current = null
    if (contentRef.current) contentRef.current.style.opacity = ''
  }, [])
  const settleInitial = useCallback(
    (messageId: string) => {
      const content = contentRef.current
      const container = containerRef.current
      if (!content || !container) return
      reveal()
      content.style.opacity = '0'
      let stable = 0
      let frames = 0
      const check = () => {
        frames += 1
        const el = findRow(messageId)
        const anchor = anchorRef.current
        // The reader took over, or another intent replaced the anchor
        if (!el || !anchor || anchor.id !== messageId) return reveal()
        const actual = el.getBoundingClientRect().top - container.getBoundingClientRect().top
        stable = Math.abs(actual - anchor.offset) <= 1 ? stable + 1 : 0
        if (stable >= 2 || frames >= SETTLE_MAX_FRAMES) return reveal()
        settleRef.current = { raf: requestAnimationFrame(check) }
      }
      settleRef.current = { raf: requestAnimationFrame(check) }
    },
    [findRow, reveal]
  )

  /** Execute the pending target if its row is present. Returns whether a
   * scroll ran (the anchor then follows it). */
  const resolveTarget = useCallback((): boolean => {
    const container = containerRef.current
    const target = targetRef.current
    if (!container || !target) return false
    if (performance.now() > target.deadline) {
      targetRef.current = null
      return false
    }

    if (target.placement.kind === 'end') {
      targetRef.current = null
      const top = container.scrollHeight - container.clientHeight
      if (target.smooth) {
        suspendUntilRef.current = performance.now() + SMOOTH_SCROLL_MS
        container.scrollTo({ top, behavior: 'smooth' })
      } else {
        writeScrollTop(top)
        recordAnchor()
      }
      return true
    }

    let messageId = target.messageId
    let placement = target.placement
    const isInitial = placement.kind === 'initial'
    if (placement.kind === 'initial') {
      // Last user message at the top; without one, the last message.
      const window = messagesRef.current
      messageId = lastTurnStartId(window) ?? window[window.length - 1]?.id
      placement = { kind: 'top' }
    }
    const el = messageId ? findRow(messageId) : null
    if (!messageId || !el) {
      return false
    }

    const elTop = rowTop(container, el)
    let top: number
    switch (placement.kind) {
      case 'top':
        top = elTop - TOP_INSET_PX
        break
      case 'center':
        top = elTop - (container.clientHeight - el.getBoundingClientRect().height) / 2
        break
      case 'offset':
        top = elTop - placement.offset
        break
    }
    targetRef.current = null
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    const clamped = Math.min(Math.max(0, top), max)
    anchorRef.current = { id: messageId, offset: elTop - clamped }
    if (target.smooth) {
      suspendUntilRef.current = performance.now() + SMOOTH_SCROLL_MS
      container.scrollTo({ top: clamped, behavior: 'smooth' })
    } else {
      writeScrollTop(clamped)
    }
    if (isInitial) settleInitial(messageId)
    return true
  }, [findRow, recordAnchor, rowTop, settleInitial, writeScrollTop])

  // A pending target retries every frame until its row appears: rows can
  // mount without changing the content's size (a short transcript inside
  // the viewport-tall wrapper), which no observer reports.
  const retryScheduledRef = useRef(false)
  const onLayoutChange = useCallback(() => {
    updateFloor()
    if (!resolveTarget() && performance.now() >= suspendUntilRef.current) {
      reapplyAnchor()
    }
    updateJump()
    if (targetRef.current && !retryScheduledRef.current) {
      retryScheduledRef.current = true
      requestAnimationFrame(() => {
        retryScheduledRef.current = false
        // Unmounted: nothing left to position
        if (!containerRef.current) {
          targetRef.current = null
          return
        }
        onLayoutChangeRef.current()
      })
    }
  }, [reapplyAnchor, resolveTarget, updateFloor, updateJump])
  const onLayoutChangeRef = useRef(onLayoutChange)
  useLayoutEffect(() => {
    onLayoutChangeRef.current = onLayoutChange
  }, [onLayoutChange])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    // Not every foreign scroll event is the reader: the browser clamps
    // scrollTop when content shrinks (a conversation switch removes the old
    // rows), so only real input cancels a pending target (see below).
    // Our own writes already set the anchor they meant to hold.
    const selfTop = selfScrollTopRef.current
    selfScrollTopRef.current = null
    if (selfTop !== null && Math.abs(container.scrollTop - selfTop) < 1) {
      updateJump()
      return
    }
    if (container.scrollTop < LOAD_EARLIER_TRIGGER_PX) onNearTopRef.current?.()
    recordAnchor()
    updateJump()
  }, [recordAnchor, updateJump])

  const jumpToLatest = useCallback(() => {
    if (!conversationId) return
    requestTranscriptScroll({
      conversationId,
      reason: 'jumpToLatest',
      placement: { kind: 'end' },
      smooth: true,
    })
  }, [conversationId])

  // Declared first: the layout effects below read the committed window.
  useLayoutEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Opening a conversation: forget the previous reader position and queue
  // the initial intent. Runs before paint so the first frame is positioned.
  useLayoutEffect(() => {
    reveal()
    anchorRef.current = null
    suspendUntilRef.current = 0
    targetRef.current = conversationId
      ? {
          placement: { kind: 'initial' },
          smooth: false,
          deadline: performance.now() + TARGET_TIMEOUT_MS,
        }
      : null
    onLayoutChange()
  }, [conversationId, onLayoutChange, reveal])

  // Window changes (send, reload, paging) commit before paint; settle the
  // floor, any pending target, and the anchor against the new rows.
  useLayoutEffect(() => {
    onLayoutChange()
  }, [messages, onLayoutChange])

  // Intents from the composer, sibling navigator, search and jump button.
  useEffect(() => {
    if (!conversationId) return
    return subscribeTranscriptScroll(conversationId, (request: TranscriptScrollRequest) => {
      const container = containerRef.current
      let placement: ResolvedPlacement
      if (request.placement.kind === 'swap') {
        // The new sibling takes the old one's on-screen position.
        const from = findRow(request.placement.fromId)
        placement =
          from && container
            ? {
                kind: 'offset',
                offset: from.getBoundingClientRect().top - container.getBoundingClientRect().top,
              }
            : { kind: 'top' }
      } else {
        placement = request.placement
      }
      targetRef.current = {
        messageId: request.messageId,
        placement,
        smooth: request.smooth ?? false,
        deadline: performance.now() + TARGET_TIMEOUT_MS,
      }
      onLayoutChange()
    })
  }, [conversationId, findRow, onLayoutChange])

  // The reader took over: wheel, touch, a press on the scrollbar, or a
  // scrolling key drops a target still waiting for its row.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const cancelTarget = () => {
      targetRef.current = null
      suspendUntilRef.current = 0
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) cancelTarget()
    }
    container.addEventListener('wheel', cancelTarget, { passive: true })
    container.addEventListener('touchstart', cancelTarget, { passive: true })
    container.addEventListener('pointerdown', cancelTarget)
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('wheel', cancelTarget)
      container.removeEventListener('touchstart', cancelTarget)
      container.removeEventListener('pointerdown', cancelTarget)
      container.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // Layout changes that do not commit through React (row heights settling,
  // images decoding, content-visibility rows rendering, window and input
  // resizes) arrive here before paint.
  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container) return

    let lastWidth: number | null = null
    const updateButtonPosition = () => {
      const target = contentRef.current
      if (!target) {
        setButtonLeft('50%')
        return
      }
      const rect = target.getBoundingClientRect()
      if (lastWidth === rect.width) return
      lastWidth = rect.width
      setButtonLeft(rect.left + rect.width / 2)
    }
    updateButtonPosition()

    const observer = new ResizeObserver(() => {
      onLayoutChange()
      updateButtonPosition()
    })
    observer.observe(container)
    if (content) observer.observe(content)
    const onResize = () => updateButtonPosition()
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [conversationId, onLayoutChange])

  return {
    containerRef,
    contentRef,
    floorRef,
    handleScroll,
    showJumpToLatest,
    jumpToLatest,
    buttonLeft,
  }
}
