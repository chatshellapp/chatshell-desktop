/**
 * Explicit scroll intents for the conversation transcript.
 *
 * Only these move the viewport; streaming growth, sync reloads, paging and
 * resizes never do (the transcript holds its top row instead). Components
 * outside the chat view (composer, sibling navigator) request an intent by
 * conversation id; the chat view's scroll hook subscribes and executes it.
 *
 * Requests coalesce per microtask: within one turn of the event loop only
 * the highest-priority request per conversation runs
 * (search > branch > send > initial > jumpToLatest; ties go to the latest).
 */

export type TranscriptScrollReason = 'search' | 'branch' | 'send' | 'initial' | 'jumpToLatest'

export type TranscriptPlacement =
  /** Row top at the transcript's top inset. */
  | { kind: 'top' }
  /** Row centered in the viewport. */
  | { kind: 'center' }
  /** Row takes the on-screen position `fromId` has when the request runs
   * (branch switch: the new sibling replaces the old one in place). */
  | { kind: 'swap'; fromId: string }
  /** End of the transcript. */
  | { kind: 'end' }

export interface TranscriptScrollRequest {
  conversationId: string
  reason: TranscriptScrollReason
  /** Target row; unused for `end`. */
  messageId?: string
  placement: TranscriptPlacement
  smooth?: boolean
}

type Handler = (request: TranscriptScrollRequest) => void

const PRIORITY: Record<TranscriptScrollReason, number> = {
  search: 5,
  branch: 4,
  send: 3,
  initial: 2,
  jumpToLatest: 1,
}

const handlers = new Map<string, Set<Handler>>()
const pending = new Map<string, TranscriptScrollRequest>()
let flushScheduled = false

function flush() {
  flushScheduled = false
  const batch = [...pending.values()]
  pending.clear()
  for (const request of batch) {
    for (const handler of handlers.get(request.conversationId) ?? []) {
      handler(request)
    }
  }
}

export function requestTranscriptScroll(request: TranscriptScrollRequest): void {
  const current = pending.get(request.conversationId)
  if (!current || PRIORITY[request.reason] >= PRIORITY[current.reason]) {
    pending.set(request.conversationId, request)
  }
  if (!flushScheduled) {
    flushScheduled = true
    queueMicrotask(flush)
  }
}

export function subscribeTranscriptScroll(conversationId: string, handler: Handler): () => void {
  let set = handlers.get(conversationId)
  if (!set) {
    set = new Set()
    handlers.set(conversationId, set)
  }
  set.add(handler)
  return () => {
    set.delete(handler)
    if (set.size === 0) handlers.delete(conversationId)
  }
}

/**
 * Direct send (composer, resend): put the newly sent user message — the
 * tail of the window once the send returned — at the top. Queued sends do
 * not call this; they go out while the reader may be elsewhere.
 */
export function requestSentMessageScroll(
  conversationId: string,
  messages: readonly { id: string; sender_type: string }[]
): void {
  const tail = messages[messages.length - 1]
  if (!tail || tail.sender_type !== 'user') return
  requestTranscriptScroll({
    conversationId,
    reason: 'send',
    messageId: tail.id,
    placement: { kind: 'top' },
  })
}
