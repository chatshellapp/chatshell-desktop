export interface AvatarData {
  type: 'text' | 'image'
  // For text avatars
  text?: string
  backgroundColor?: string
  // For image avatars
  imageUrl?: string
  // Common
  fallback?: string
  // Special flag for placeholder avatars
  isPlaceholder?: boolean
}

export interface MessageListItemProps {
  /**
   * Array of avatar URLs or avatar data objects
   */
  avatars: (string | AvatarData)[]
  /**
   * Message summary or conversation title
   */
  summary: string
  /**
   * Timestamp of the last message
   */
  timestamp: string
  /**
   * Content of the last message
   */
  lastMessage: string
  /**
   * Optional click handler
   */
  onClick?: () => void
  /**
   * Optional className for customization
   */
  className?: string
  /**
   * Whether the item is selected/active
   */
  isActive?: boolean
  /**
   * Handler for generate title action
   */
  onGenerateTitle?: () => void
  /**
   * Handler for edit title action - receives the new title
   */
  onEditTitle?: (newTitle: string) => void
  /**
   * Handler for delete action
   */
  onDelete?: () => void
}
