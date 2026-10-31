import { invoke } from '@tauri-apps/api/core'
import type { Message, Conversation, SiblingGroup } from '@/types'
import type {
  ImmerSet,
  StoreGet,
  MessageStoreCrudActions,
  SendMessageParameterOverrides,
  PendingMessage,
  RunOutcome,
} from './types'
import { MESSAGES_PAGE_SIZE } from './types'
import { cleanupThrottleState } from './throttle'
import { logger } from '@/lib/logger'

export const createCrudActions = (set: ImmerSet, get: StoreGet): MessageStoreCrudActions => ({
  loadMessages: async (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists

    // Update the state to loading
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isLoading = true
      }
      draft.error = null
    })

    try {
      // One extra row detects older messages beyond the window. Sibling
      // groups ride along but must not fail the message load (the
      // navigator simply hides when unavailable).
      const [messages, siblingGroups] = await Promise.all([
        invoke<Message[]>('list_messages_by_conversation', {
          conversationId,
          limit: MESSAGES_PAGE_SIZE + 1,
        }),
        invoke<SiblingGroup[]>('get_sibling_groups', { conversationId })
          .then((groups) => groups ?? [])
          .catch(() => [] as SiblingGroup[]),
      ])
      const hasOlderMessages = messages.length > MESSAGES_PAGE_SIZE
      // ASC order: the extra detection row is the OLDEST, so keep the tail.
      const window = hasOlderMessages
        ? messages.slice(messages.length - MESSAGES_PAGE_SIZE)
        : messages

      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.messages = window
          convState.hasOlderMessages = hasOlderMessages
          convState.isLoading = false
          // '' keys the first-turn group (messages without a parent).
          const groups: Record<string, string[]> = {}
          for (const group of siblingGroups) {
            groups[group.parent_id ?? ''] = group.message_ids
          }
          convState.siblingGroups = groups
        }
      })
    } catch (error) {
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isLoading = false
        }
        draft.error = String(error)
      })
      logger.error('Failed to load messages:', error)
    }
  },

  // Prepend the next older page into the window. Returns whether any
  // message was loaded; false when exhausted or already in flight.
  loadOlderMessages: async (conversationId: string) => {
    const convState = get().getConversationState(conversationId)
    if (!convState.hasOlderMessages || convState.isLoadingOlder) return false
    const oldest = convState.messages[0]
    if (!oldest) return false

    set((draft) => {
      const cs = draft.conversationStates[conversationId]
      if (cs) {
        cs.isLoadingOlder = true
      }
    })

    try {
      const page = await invoke<Message[]>('list_messages_by_conversation', {
        conversationId,
        limit: MESSAGES_PAGE_SIZE + 1,
        beforeCreatedAt: oldest.created_at,
        beforeId: oldest.id,
      })
      const hasOlderMessages = page.length > MESSAGES_PAGE_SIZE
      // ASC order: drop the extra oldest detection row from the page head.
      const window = hasOlderMessages ? page.slice(page.length - MESSAGES_PAGE_SIZE) : page

      set((draft) => {
        const cs = draft.conversationStates[conversationId]
        if (cs) {
          cs.messages = [...window, ...cs.messages]
          cs.hasOlderMessages = hasOlderMessages
          cs.isLoadingOlder = false
        }
      })
      return window.length > 0
    } catch (error) {
      set((draft) => {
        const cs = draft.conversationStates[conversationId]
        if (cs) {
          cs.isLoadingOlder = false
        }
      })
      logger.error('Failed to load older messages:', error)
      return false
    }
  },

  // Load every older page into the window. UI consumers that need the whole
  // conversation (screenshot export) use this; ordinary scrolling keeps the
  // bounded tail window.
  loadAllMessages: async (conversationId: string) => {
    for (;;) {
      const convState = get().getConversationState(conversationId)
      if (!convState.hasOlderMessages) return
      // A scroll-triggered page may already be in flight; wait for it instead
      // of treating its NO-OP result as "history exhausted".
      if (convState.isLoadingOlder) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 0)
        await promise
        continue
      }
      const loaded = await get().loadOlderMessages(conversationId)
      if (!loaded) return
    }
  },

  // Load upward pages until messageId is inside the window (used by the
  // in-conversation search jump when the target is older than the window).
  ensureMessageLoaded: async (conversationId: string, messageId: string) => {
    for (;;) {
      const convState = get().getConversationState(conversationId)
      if (convState.messages.some((m) => m.id === messageId)) return
      if (!convState.hasOlderMessages) return
      const loaded = await get().loadOlderMessages(conversationId)
      if (!loaded) return
    }
  },

  sendMessage: async (
    content: string,
    conversationId: string | null,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    apiStyle?: string,
    includeHistory?: boolean,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string,
    urlsToFetch?: string[],
    images?: { name: string; base64: string; mimeType: string }[],
    files?: { name: string; content: string; mimeType: string }[],
    searchEnabled?: boolean,
    parameterOverrides?: SendMessageParameterOverrides,
    contextMessageCount?: number | null,
    useProviderDefaults?: boolean,
    reuseFetchResultIds?: string[],
    siblingOfMessageId?: string
  ) => {
    set((draft) => {
      draft.isSending = true
      draft.error = null
    })

    try {
      // If no conversationId, create a new conversation first
      let targetId = conversationId
      if (!targetId) {
        logger.info('[messageStore] No conversation ID provided, creating new conversation...')
        const newConversation = await invoke<Conversation>('create_conversation', {
          req: { title: '' },
        })
        targetId = newConversation.id
        logger.info('[messageStore] Created new conversation:', newConversation)

        // Notify via callback (avoids direct store coupling)
        const callback = get().onNewConversationCreated
        if (callback) {
          callback(newConversation)
        }
      }

      // A conversation drafted in the UI gets its database row on the first send
      const { useConversationStore } = await import('../conversation')
      await useConversationStore.getState().saveDraftConversation(targetId)

      // Set waiting state for this conversation and clear previous streaming content
      get().getConversationState(targetId) // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[targetId]
        if (convState) {
          convState.isStreaming = true
          convState.isWaitingForAI = true
          convState.streamingContent = ''
          convState.streamingReasoningContent = ''
          convState.streamingToolCalls = {}
          convState.failedTurn = null
          convState.stopRequested = false
          convState.regenerateTargetId = null
        }
      })

      logger.info('[messageStore] Invoking send_message command with params:', {
        conversationId: targetId,
        contentLength: content.length,
        provider,
        model,
        hasApiKey: !!apiKey,
        baseUrl,
        includeHistory,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        modelDbId,
        assistantDbId,
        hasImages: !!images?.length,
        hasFiles: !!files?.length,
        searchEnabled,
        hasParameterOverrides: !!parameterOverrides,
        contextMessageCount,
        useProviderDefaults,
        hasReuseFetchResultIds: !!reuseFetchResultIds?.length,
      })

      // This will return the user message immediately
      const userMessage = await invoke<Message>('send_message', {
        conversationId: targetId,
        content,
        provider,
        model,
        apiKey,
        baseUrl,
        apiStyle,
        includeHistory,
        systemPrompt,
        userPrompt,
        modelDbId,
        assistantDbId,
        urlsToFetch,
        images,
        files,
        searchEnabled,
        parameterOverrides,
        contextMessageCount,
        useProviderDefaults,
        reuseFetchResultIds,
        siblingOfMessageId,
      })

      logger.info('[messageStore] Received user message:', userMessage)

      // Add user message to the conversation. A resend replaces the
      // original's branch: the window follows the rewound leaf, so the
      // original and everything after it leave the window.
      set((draft) => {
        const convState = draft.conversationStates[targetId]
        if (convState) {
          if (siblingOfMessageId) {
            const idx = convState.messages.findIndex((m: Message) => m.id === siblingOfMessageId)
            if (idx >= 0) convState.messages = convState.messages.slice(0, idx)
          }
          convState.messages.push(userMessage)
        }
        draft.isSending = false
      })

      // Bump the conversation to the top of the sidebar list
      useConversationStore.getState().bumpConversation(targetId, content)

      logger.info('[messageStore] User message added to store, waiting for assistant response...')

      // The assistant message will be added via the chat-complete event
    } catch (error) {
      logger.error('[messageStore] Error in sendMessage:', error)
      logger.error('[messageStore] Error type:', typeof error)
      logger.error('[messageStore] Error details:', {
        error,
        errorString: String(error),
        errorKeys: error ? Object.keys(error) : 'null',
      })

      set((draft) => {
        draft.error = String(error)
        draft.isSending = false
      })
      throw error
    }
  },

  stopGeneration: async (conversationId: string) => {
    try {
      logger.info('[messageStore] Stopping generation for conversation:', conversationId)
      await invoke('stop_generation', { conversationId })

      // The completion that follows is a stop, not a normal finish
      get().getConversationState(conversationId) // Ensure state exists
      set((draft) => {
        draft.isSending = false
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.stopRequested = true
        }
      })

      logger.info('[messageStore] Generation stopped successfully')
    } catch (error) {
      logger.error('[messageStore] Failed to stop generation:', error)
    }
  },

  clearMessages: async (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists

    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.isLoading = true
      }
      draft.error = null
    })

    try {
      await invoke('clear_messages_by_conversation', { conversationId })

      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.messages = []
          convState.isLoading = false
        }
      })
    } catch (error) {
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isLoading = false
        }
        draft.error = String(error)
      })
      throw error
    }
  },

  // Non-destructive resend: the new user message becomes a sibling variant
  // of `siblingOfMessageId` instead of appending under the active leaf.
  resendMessage: async (
    content: string,
    conversationId: string,
    siblingOfMessageId: string,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    apiStyle?: string,
    includeHistory?: boolean,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string,
    urlsToFetch?: string[],
    images?: { name: string; base64: string; mimeType: string }[],
    files?: { name: string; content: string; mimeType: string }[],
    searchEnabled?: boolean,
    parameterOverrides?: SendMessageParameterOverrides,
    contextMessageCount?: number | null,
    useProviderDefaults?: boolean,
    reuseFetchResultIds?: string[]
  ) => {
    await get().sendMessage(
      content,
      conversationId,
      provider,
      model,
      apiKey,
      baseUrl,
      apiStyle,
      includeHistory,
      systemPrompt,
      userPrompt,
      modelDbId,
      assistantDbId,
      urlsToFetch,
      images,
      files,
      searchEnabled,
      parameterOverrides,
      contextMessageCount,
      useProviderDefaults,
      reuseFetchResultIds,
      siblingOfMessageId
    )
  },

  // Re-fetch only the sibling variant groups (after a turn created or
  // removed a branch point). Cheaper than a full loadMessages.
  refreshSiblingGroups: async (conversationId: string) => {
    try {
      const siblingGroups = await invoke<SiblingGroup[]>('get_sibling_groups', {
        conversationId,
      })
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          const groups: Record<string, string[]> = {}
          for (const group of siblingGroups) {
            groups[group.parent_id ?? ''] = group.message_ids
          }
          convState.siblingGroups = groups
        }
      })
    } catch (error) {
      logger.error('Failed to refresh sibling groups:', error)
    }
  },

  deleteMessagesFrom: async (conversationId: string, messageId: string) => {
    get().getConversationState(conversationId)

    try {
      await invoke('delete_messages_from', { conversationId, messageId })

      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          const idx = convState.messages.findIndex((m: Message) => m.id === messageId)
          if (idx >= 0) {
            convState.messages = convState.messages.slice(0, idx)
          }
        }
      })
      // Deleted members leave their sibling groups (off-branch variants
      // survive); refresh so the navigator counts stay accurate.
      await get().refreshSiblingGroups(conversationId)
    } catch (error) {
      logger.error('[messageStore] Failed to delete messages from:', error)
      throw error
    }
  },

  // Switch the conversation's active branch: the backend lands on the
  // chosen branch's newest leaf, then we reload the path + sibling groups.
  setActiveBranch: async (conversationId: string, messageId: string) => {
    try {
      await invoke('set_active_message', { conversationId, messageId })
      await get().loadMessages(conversationId)
    } catch (error) {
      logger.error('Failed to switch branch:', error)
      throw error
    }
  },

  // Regenerate an assistant reply as a sibling variant. Mirrors
  // sendMessage's streaming-state handling, but re-answers the existing
  // user message instead of creating one.
  regenerateMessage: async (
    conversationId: string,
    messageId: string,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    apiStyle?: string,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string,
    parameterOverrides?: SendMessageParameterOverrides,
    contextMessageCount?: number | null,
    useProviderDefaults?: boolean,
    disableTools?: boolean
  ) => {
    get().getConversationState(conversationId)
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        // The backend rewinds the leaf to the answered user message: the
        // window follows, dropping the replaced reply and its descendants.
        // A user target is a retry of a turn without a reply; it keeps the
        // reply an earlier failed regenerate replaced.
        const idx = convState.messages.findIndex((m: Message) => m.id === messageId)
        const target = idx >= 0 ? convState.messages[idx] : undefined
        if (target?.sender_type === 'user') {
          convState.messages = convState.messages.slice(0, idx + 1)
          convState.regenerateTargetId = convState.failedTurn?.previousReplyId ?? null
        } else {
          if (idx >= 0) convState.messages = convState.messages.slice(0, idx)
          convState.regenerateTargetId = messageId
        }
        convState.isStreaming = true
        convState.isWaitingForAI = true
        convState.streamingContent = ''
        convState.streamingReasoningContent = ''
        convState.streamingToolCalls = {}
        convState.failedTurn = null
        convState.stopRequested = false
      }
    })

    try {
      await invoke('regenerate_message', {
        conversationId,
        messageId,
        provider,
        model,
        apiKey,
        baseUrl,
        apiStyle,
        systemPrompt,
        userPrompt,
        modelDbId,
        assistantDbId,
        parameterOverrides,
        contextMessageCount,
        useProviderDefaults,
        disableTools,
      })
      // The regenerated assistant message arrives via chat-complete, which
      // also refreshes the sibling groups.
    } catch (error) {
      logger.error('Failed to regenerate message:', error)
      set((draft) => {
        const convState = draft.conversationStates[conversationId]
        if (convState) {
          convState.isStreaming = false
          convState.isWaitingForAI = false
        }
      })
      throw error
    }
  },

  addMessage: (conversationId: string, message: Message) => {
    logger.info('[messageStore] Adding message to conversation:', conversationId)
    get().getConversationState(conversationId) // Ensure state exists

    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        // Check if message already exists
        const existingIndex = convState.messages.findIndex((m: Message) => m.id === message.id)

        if (existingIndex >= 0) {
          // Replace existing message (idempotent behavior)
          logger.info('[messageStore] Message exists, replacing:', message.id)
          convState.messages[existingIndex] = message
        } else {
          // Add new message
          convState.messages.push(message)
        }

        convState.isWaitingForAI = false
      }
    })
  },

  setAttachmentStatus: (
    conversationId: string,
    status: 'idle' | 'processing' | 'complete' | 'error'
  ) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.attachmentStatus = status
      }
    })
  },

  incrementAttachmentRefreshKey: (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.attachmentRefreshKey += 1
      }
    })
  },

  failTurn: (conversationId: string, kind: 'failed' | 'stopped', error: string | null) => {
    get().getConversationState(conversationId) // Ensure state exists
    const previousReplyId = get().conversationStates[conversationId]?.regenerateTargetId ?? null
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.failedTurn = { kind, error, previousReplyId }
        convState.regenerateTargetId = null
        convState.stopRequested = false
        convState.isStreaming = false
        convState.isWaitingForAI = false
        convState.streamingContent = ''
      }
    })
    // A regenerate that produced nothing left the backend leaf on the
    // unanswered user message: point it back at the replaced reply so a
    // relaunch or another device lands on an answer. The window keeps the
    // failed turn until the user asks for the previous reply.
    if (previousReplyId) {
      invoke('set_active_message', { conversationId, messageId: previousReplyId }).catch(
        (error) => {
          logger.error('[messageStore] Failed to restore the previous reply:', error)
        }
      )
    }
  },

  setRunOutcome: (conversationId: string, messageId: string, outcome: RunOutcome) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.runOutcomes[messageId] = outcome
      }
    })
  },

  dismissFailedTurn: (conversationId: string) => {
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.failedTurn = null
      }
    })
    get().processNextPendingMessage(conversationId)
  },

  showPreviousReply: async (conversationId: string) => {
    await get().loadMessages(conversationId)
    get().dismissFailedTurn(conversationId)
  },

  cleanupConversation: (conversationId: string) => {
    // Clean up throttle state
    cleanupThrottleState(conversationId)

    // Reset streaming state for this conversation
    get().getConversationState(conversationId) // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.streamingContent = ''
        convState.streamingReasoningContent = ''
        convState.isStreaming = false
        convState.isWaitingForAI = false
        convState.attachmentStatus = 'idle'
        convState.pendingMessages = []
      }
    })
  },

  removeConversationState: (conversationId: string) => {
    // Clean up throttle state
    cleanupThrottleState(conversationId)

    // Completely remove conversation state from memory
    set((draft) => {
      delete draft.conversationStates[conversationId]
    })

    logger.info('[messageStore] Removed conversation state for:', conversationId)
  },

  enqueueMessage: (conversationId: string, message: PendingMessage) => {
    get().getConversationState(conversationId)
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.pendingMessages.push(message)
      }
    })
    logger.info('[messageStore] Enqueued pending message for conversation:', conversationId)
  },

  removePendingMessage: (conversationId: string, index: number) => {
    get().getConversationState(conversationId)
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState && index >= 0 && index < convState.pendingMessages.length) {
        convState.pendingMessages.splice(index, 1)
      }
    })
    logger.info('[messageStore] Removed pending message at index', { index, conversationId })
  },

  processNextPendingMessage: (conversationId: string) => {
    const convState = get().getConversationState(conversationId)
    if (convState.pendingMessages.length === 0) return
    // A failed turn pauses the queue: queued messages would otherwise go
    // out after an unanswered question. Retry or dismiss resumes it.
    if (convState.failedTurn?.kind === 'failed') return

    const next = convState.pendingMessages[0]
    set((draft) => {
      const cs = draft.conversationStates[conversationId]
      if (cs) {
        cs.pendingMessages = cs.pendingMessages.slice(1)
      }
    })

    logger.info('[messageStore] Processing next pending message for conversation:', conversationId)

    get().sendMessage(
      next.content,
      next.conversationId,
      next.provider,
      next.model,
      next.apiKey,
      next.baseUrl,
      next.apiStyle,
      next.includeHistory,
      next.systemPrompt,
      next.userPrompt,
      next.modelDbId,
      next.assistantDbId,
      next.urlsToFetch,
      next.images,
      next.files,
      next.searchEnabled,
      next.parameterOverrides,
      next.contextMessageCount,
      next.useProviderDefaults,
      next.reuseFetchResultIds
    )
  },

  clearPendingMessages: (conversationId: string) => {
    get().getConversationState(conversationId)
    set((draft) => {
      const convState = draft.conversationStates[conversationId]
      if (convState) {
        convState.pendingMessages = []
      }
    })
    logger.info('[messageStore] Cleared pending messages for conversation:', conversationId)
  },
})
