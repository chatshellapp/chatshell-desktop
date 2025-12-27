import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ParticipantSummary } from '@/types'
import { useConversationStore } from '@/stores/conversation'
import { useUserStore } from '@/stores/UserStore'
import { logger } from '@/lib/logger'

export function useConversationParticipants() {
  const conversations = useConversationStore((state) => state.conversations)
  const selfUser = useUserStore((state) => state.selfUser)
  const loadConversations = useConversationStore((state) => state.loadConversations)

  const [conversationParticipantsMap, setConversationParticipantsMap] = useState<
    Map<string, ParticipantSummary[]>
  >(new Map())

  // Load participants for all conversations
  useEffect(() => {
    const loadAllParticipants = async () => {
      if (conversations.length === 0 || !selfUser) {
        return
      }

      const participantsMap = new Map()

      await Promise.all(
        conversations.map(async (conversation) => {
          try {
            const participants = await invoke<ParticipantSummary[]>(
              'get_conversation_participant_summary',
              {
                conversationId: conversation.id,
                currentUserId: selfUser.id,
              }
            )
            participantsMap.set(conversation.id, participants)
          } catch (error) {
            logger.error(`Failed to load participants for conversation ${conversation.id}:`, error)
            participantsMap.set(conversation.id, [])
          }
        })
      )

      setConversationParticipantsMap(participantsMap)
    }

    loadAllParticipants()
  }, [conversations, selfUser])

  // Refresh participants for a specific conversation
  const refreshConversationParticipants = useCallback(
    async (conversationId: string) => {
      if (!selfUser) return

      try {
        const participants = await invoke<ParticipantSummary[]>(
          'get_conversation_participant_summary',
          {
            conversationId: conversationId,
            currentUserId: selfUser.id,
          }
        )

        setConversationParticipantsMap((prev) => {
          const newMap = new Map(prev)
          newMap.set(conversationId, participants)
          return newMap
        })
      } catch (error) {
        logger.error('Failed to refresh participants:', error)
      }
    },
    [selfUser]
  )

  // Listen for chat-complete event
  useEffect(() => {
    const unlistenComplete = listen(
      'chat-complete',
      (event: { payload: { conversation_id?: string } }) => {
        if (event.payload.conversation_id) {
          setTimeout(() => {
            refreshConversationParticipants(event.payload.conversation_id!)
            loadConversations()
          }, 100)
        }
      }
    )

    return () => {
      unlistenComplete.then((fn) => fn())
    }
  }, [refreshConversationParticipants, loadConversations])

  return { conversationParticipantsMap, refreshConversationParticipants }
}
