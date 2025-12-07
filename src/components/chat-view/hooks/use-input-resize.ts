import { useRef, useState, useEffect, useCallback, RefObject } from 'react'

interface UseInputResizeReturn {
  rootRef: RefObject<HTMLDivElement | null>
  inputAreaRef: RefObject<HTMLDivElement | null>
  inputAreaHeight: number
  manualInputHeight: number | null
  handleDragStart: (e: React.MouseEvent) => void
}

export function useInputResize(): UseInputResizeReturn {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)

  // Track input area height for button positioning
  const [inputAreaHeight, setInputAreaHeight] = useState(0)
  const [manualInputHeight, setManualInputHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  // Store the initial height of the input area to use as minimum
  const initialHeightRef = useRef<number>(0)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleDragMove = (e: MouseEvent) => {
      if (!isResizing || !rootRef.current) return

      const rootRect = rootRef.current.getBoundingClientRect()
      const maxHeight = rootRect.height / 2
      // Calculate new height based on distance from bottom
      const newHeight = rootRect.bottom - e.clientY

      // Clamp height
      // Min height: initial height (to ensure controls are visible) or fallback to 140
      const minHeight = initialHeightRef.current || 140
      const clampedHeight = Math.min(Math.max(newHeight, minHeight), maxHeight)

      setManualInputHeight(clampedHeight)
    }

    const handleDragEnd = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      window.addEventListener('mousemove', handleDragMove)
      window.addEventListener('mouseup', handleDragEnd)
      // Add a class to body to force cursor style globally while dragging
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    return () => {
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  // Measure input area height and update on resize
  useEffect(() => {
    const inputArea = inputAreaRef.current
    if (!inputArea) return

    // Initial measurement
    const updateHeight = () => {
      const height = inputArea.offsetHeight
      setInputAreaHeight(height)

      // Capture initial height if not set and we're not in manual resize mode
      // This serves as the minimum height constraint
      if (initialHeightRef.current === 0 && height > 0 && manualInputHeight === null) {
        initialHeightRef.current = height
      }
    }

    updateHeight()

    // Use ResizeObserver to watch for height changes
    const resizeObserver = new ResizeObserver(() => {
      updateHeight()
    })

    resizeObserver.observe(inputArea)

    return () => {
      resizeObserver.disconnect()
    }
  }, [manualInputHeight])

  return {
    rootRef,
    inputAreaRef,
    inputAreaHeight,
    manualInputHeight,
    handleDragStart,
  }
}

