import type {
  Conversation,
  ConversationParticipant,
  Model,
  Assistant,
} from '@/types'
import type { Draft } from 'immer'

// Conversation store state (without actions)
export interface ConversationStoreState {
  conversations: Conversation[]
  currentConversation: Conversation | null
  currentParticipants: ConversationParticipant[]

  // User can select EITHER a model OR an assistant (not both)
  selectedModel: Model | null
  selectedAssistant: Assistant | null

  // Track last used model/assistant for default selection
  lastUsedModel: Model | null
  lastUsedAssistant: Assistant | null
  isFirstConversationSinceStartup: boolean

  isLoading: boolean
  error: string | null
}

// Selector actions
export interface ConversationStoreSelectors {
  // Helper to get current effective model
  getCurrentModel: () => Model | null
}

// Main actions (conversation CRUD, participant management, selection)
export interface ConversationStoreActions {
  // Conversation actions
  loadConversations: () => Promise<void>
  createConversation: (title: string) => Promise<Conversation>
  updateConversation: (id: string, title: string) => Promise<Conversation>
  deleteConversation: (id: string) => Promise<void>
  selectConversation: (id: string) => Promise<void>
  setCurrentConversation: (conversation: Conversation | null) => void

  // Participant actions
  loadParticipants: (conversationId: string) => Promise<void>
  addParticipant: (
    conversationId: string,
    participantType: string,
    participantId?: string,
    displayName?: string
  ) => Promise<void>
  removeParticipant: (participantId: string) => Promise<void>

  // Selection actions
  setSelectedModel: (model: Model | null) => void
  setSelectedAssistant: (assistant: Assistant | null) => void
}

// Combined conversation store type
export interface ConversationStore
  extends ConversationStoreState,
    ConversationStoreSelectors,
    ConversationStoreActions {}

// Helper types for action creators
export type ImmerSet = (
  nextStateOrUpdater: ConversationStore | Partial<ConversationStore> | ((state: Draft<ConversationStore>) => void)
) => void
export type StoreGet = () => ConversationStore

