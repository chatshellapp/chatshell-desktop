import type { ResolvedContact } from '@/hooks/useContactProfile'
import { AssistantProfile } from './assistant-profile'
import { ModelProfile } from './model-profile'

interface ContactProfileProps {
  contact: ResolvedContact
  /** Called after a chat with the contact was opened, to leave the profile */
  onChatOpened: () => void
}

export function ContactProfile({ contact, onChatOpened }: ContactProfileProps) {
  return contact.kind === 'model' ? (
    <ModelProfile key={contact.model.id} model={contact.model} onChatOpened={onChatOpened} />
  ) : (
    <AssistantProfile
      key={contact.assistant.id}
      assistant={contact.assistant}
      onChatOpened={onChatOpened}
    />
  )
}
