import { getModelLogo, getModelLogoById } from '@/lib/model-logos'
import type { ParticipantSummary, Model } from '@/types'
import type { AvatarData } from '@/components/message-list-item'

export function buildConversationAvatars(
  participants: ParticipantSummary[],
  getModelById: (id: string) => Model | undefined
): AvatarData[] {
  const avatars: AvatarData[] = []

  participants.forEach((participant) => {
    if (participant.participant_type === 'assistant') {
      const hasCustomImage =
        participant.avatar_type === 'image' &&
        (participant.avatar_image_url || participant.avatar_image_path)

      if (hasCustomImage) {
        avatars.push({
          type: 'image',
          imageUrl: participant.avatar_image_url || participant.avatar_image_path || '',
          fallback: participant.avatar_text || participant.display_name.charAt(0).toUpperCase(),
        })
      } else {
        const avatarBg = participant.avatar_bg || '#3b82f6'
        avatars.push({
          type: 'text',
          text: participant.avatar_text || participant.display_name.charAt(0).toUpperCase(),
          backgroundColor: avatarBg,
          fallback: participant.avatar_text || participant.display_name.charAt(0).toUpperCase(),
        })
      }
    } else if (participant.participant_type === 'model' && participant.participant_id) {
      // The store includes deleted models (their tombstones keep name and
      // model_id). When the row is unavailable (e.g. not synced yet), fall
      // back to the display name snapshotted on the participant.
      const model = getModelById(participant.participant_id)
      const name = model?.name || participant.display_name
      if (!name) return
      const modelLogo = model ? getModelLogo(model) : getModelLogoById(name)
      const initial = name.charAt(0).toUpperCase()
      if (modelLogo) {
        avatars.push({
          type: 'image',
          imageUrl: modelLogo,
          fallback: initial,
        })
      } else {
        // Don't set backgroundColor - let the Avatar use its default bg-muted styling
        // This matches the behavior of ModelAvatar component
        avatars.push({
          type: 'text',
          text: initial,
          fallback: initial,
        })
      }
    } else if (participant.participant_type === 'user') {
      if (participant.avatar_type === 'image') {
        const imageUrl = participant.avatar_image_url || participant.avatar_image_path
        if (imageUrl) {
          avatars.push({
            type: 'image',
            imageUrl,
            fallback: participant.display_name.charAt(0).toUpperCase(),
          })
        }
      } else {
        avatars.push({
          type: 'text',
          text: participant.avatar_text || participant.display_name.charAt(0).toUpperCase(),
          backgroundColor: participant.avatar_bg || '#6366f1',
          fallback: participant.display_name.charAt(0).toUpperCase(),
        })
      }
    }
  })

  return avatars
}
