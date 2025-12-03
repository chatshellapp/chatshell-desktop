import { MessageListItem } from '@/components/message-list-item'
import { useConversationStore } from '@/stores/conversationStore'
import { useModelStore } from '@/stores/modelStore'
import { formatConversationTimestamp } from '@/lib/utils'
import { buildConversationAvatars } from '@/lib/conversation-avatars'
import type { ParticipantSummary } from '@/types'

interface ConversationListProps {
  conversationParticipantsMap: Map<string, ParticipantSummary[]>
  onConversationClick: (conversationId: string) => void
  onGenerateTitle?: (conversationId: string) => void
  onEditTitle?: (conversationId: string) => void
  onDelete?: (conversationId: string) => void
}

export function ConversationList({
  conversationParticipantsMap,
  onConversationClick,
  onGenerateTitle,
  onEditTitle,
  onDelete,
}: ConversationListProps) {
  const conversations = useConversationStore((state) => state.conversations)
  const currentConversation = useConversationStore((state) => state.currentConversation)
  const getModelById = useModelStore((state) => state.getModelById)

  if (conversations.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">No conversations yet</div>
    )
  }

  return (
    <div className="space-y-1 p-2">
      {conversations.map((conversation) => {
        const participants = conversationParticipantsMap.get(conversation.id) || []
        const avatars = buildConversationAvatars(participants, getModelById)

        const displayAvatars =
          avatars.length > 0
            ? avatars
            : [
                {
                  type: 'text' as const,
                  text: '',
                  fallback: '',
                  isPlaceholder: true,
                },
              ]

        const lastMessage = conversation.last_message
          ? conversation.last_message.length > 50
            ? conversation.last_message.substring(0, 50) + '...'
            : conversation.last_message
          : 'No messages yet'

        return (
          <MessageListItem
            key={conversation.id}
            avatars={displayAvatars}
            summary={conversation.title}
            timestamp={formatConversationTimestamp(conversation.updated_at)}
            lastMessage={lastMessage}
            isActive={currentConversation?.id === conversation.id}
            onClick={() => onConversationClick(conversation.id)}
            onGenerateTitle={onGenerateTitle ? () => onGenerateTitle(conversation.id) : undefined}
            onEditTitle={onEditTitle ? () => onEditTitle(conversation.id) : undefined}
            onDelete={onDelete ? () => onDelete(conversation.id) : undefined}
          />
        )
      })}
    </div>
  )
}
