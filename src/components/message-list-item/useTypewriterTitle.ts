import { useEffect, useRef, useState } from 'react'

/**
 * Animates a title transition with a fast typewriter effect:
 * deletes the old text char-by-char, then types the new text char-by-char.
 *
 * Only activates when transitioning from `placeholderTitle` to a real title.
 * All other changes are applied instantly.
 */
export function useTypewriterTitle(
  title: string,
  placeholderTitle: string | undefined,
  deleteSpeed = 18,
  typeSpeed = 15
): string {
  const [display, setDisplay] = useState(title)
  const prevRef = useRef(title)
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = title

    if (prev === title) return

    const wasPlaceholder = placeholderTitle && prev === placeholderTitle
    const isReal = title && title !== placeholderTitle
    if (!wasPlaceholder || !isReal) {
      setDisplay(title)
      return
    }

    // Cancel any running animation
    if (animRef.current) clearTimeout(animRef.current)

    let cancelled = false
    let idx = prev.length

    function deletePhase() {
      if (cancelled) return
      idx--
      if (idx >= 0) {
        setDisplay(prev.slice(0, idx))
        animRef.current = setTimeout(deletePhase, deleteSpeed)
      } else {
        idx = 0
        typePhase()
      }
    }

    function typePhase() {
      if (cancelled) return
      idx++
      setDisplay(title.slice(0, idx))
      if (idx < title.length) {
        animRef.current = setTimeout(typePhase, typeSpeed)
      } else {
        animRef.current = null
      }
    }

    deletePhase()

    return () => {
      cancelled = true
      if (animRef.current) {
        clearTimeout(animRef.current)
        animRef.current = null
      }
      setDisplay(title)
    }
  }, [title, placeholderTitle, deleteSpeed, typeSpeed])

  return display
}
