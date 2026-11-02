import { createContext, useContext } from 'react'

/**
 * True inside a message that is still streaming. Blocks whose source may
 * still grow (an open ```svg fence) use it to repair partial input and to
 * hold off on failure fallbacks until the message is final.
 */
export const MarkdownStreamingContext = createContext(false)

export function useMarkdownStreaming(): boolean {
  return useContext(MarkdownStreamingContext)
}
