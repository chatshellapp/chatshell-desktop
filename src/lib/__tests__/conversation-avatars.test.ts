import { describe, it, expect } from 'vitest'
import { buildConversationAvatars } from '../conversation-avatars'
import type { Model, ParticipantSummary } from '@/types'
import gptAvatar from '@/assets/avatars/models/gpt.png'

const makeParticipant = (overrides: Partial<ParticipantSummary> = {}): ParticipantSummary => ({
  participant_type: 'assistant',
  display_name: 'Assistant',
  avatar_type: 'text',
  ...overrides,
})

const makeModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'model-1',
  name: 'GPT-4o',
  provider_id: 'openai',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('buildConversationAvatars', () => {
  it('returns an empty array for no participants', () => {
    expect(buildConversationAvatars([], () => undefined)).toEqual([])
  })

  describe('assistant participants', () => {
    it('uses the custom image url when avatar_type is image with a url', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ avatar_type: 'image', avatar_image_url: 'https://img.example/a.png' })],
        () => undefined
      )

      expect(avatars).toEqual([
        {
          type: 'image',
          imageUrl: 'https://img.example/a.png',
          fallback: 'A',
        },
      ])
    })

    it('falls back to the image path when no url is set', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ avatar_type: 'image', avatar_image_path: '/avatars/a.png' })],
        () => undefined
      )

      expect(avatars).toEqual([{ type: 'image', imageUrl: '/avatars/a.png', fallback: 'A' }])
    })

    it('falls back to a text avatar when avatar_type is image without any source', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ avatar_type: 'image', display_name: 'helper', avatar_text: 'H' })],
        () => undefined
      )

      expect(avatars).toEqual([
        { type: 'text', text: 'H', backgroundColor: '#3b82f6', fallback: 'H' },
      ])
    })

    it('builds a text avatar with custom text and background', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ avatar_text: 'Bot', avatar_bg: '#111827' })],
        () => undefined
      )

      expect(avatars).toEqual([
        { type: 'text', text: 'Bot', backgroundColor: '#111827', fallback: 'Bot' },
      ])
    })

    it('uppercases the first display name letter when no avatar text exists', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ display_name: 'nova' })],
        () => undefined
      )

      expect(avatars).toEqual([
        { type: 'text', text: 'N', backgroundColor: '#3b82f6', fallback: 'N' },
      ])
    })
  })

  describe('model participants', () => {
    it('uses the vendor logo when the model resolves with a known logo', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ participant_type: 'model', participant_id: 'model-1' })],
        (id) => (id === 'model-1' ? makeModel() : undefined)
      )

      expect(avatars).toEqual([{ type: 'image', imageUrl: gptAvatar, fallback: 'G' }])
    })

    it('uses a text avatar without background when the model has no logo', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ participant_type: 'model', participant_id: 'model-1' })],
        () => makeModel({ model_id: 'internal-alias', name: 'zephyr-custom' })
      )

      expect(avatars).toEqual([{ type: 'text', text: 'Z', fallback: 'Z' }])
    })

    it('skips model participants whose model cannot be found', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ participant_type: 'model', participant_id: 'missing' })],
        () => undefined
      )

      expect(avatars).toEqual([])
    })

    it('skips model participants without a participant id', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ participant_type: 'model', participant_id: undefined })],
        () => makeModel()
      )

      expect(avatars).toEqual([])
    })
  })

  describe('user participants', () => {
    it('uses the image url when avatar_type is image with a source', () => {
      const avatars = buildConversationAvatars(
        [
          makeParticipant({
            participant_type: 'user',
            avatar_type: 'image',
            avatar_image_url: 'https://img.example/u.png',
            display_name: 'sean',
          }),
        ],
        () => undefined
      )

      expect(avatars).toEqual([
        { type: 'image', imageUrl: 'https://img.example/u.png', fallback: 'S' },
      ])
    })

    it('skips user image avatars without any image source', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ participant_type: 'user', avatar_type: 'image' })],
        () => undefined
      )

      expect(avatars).toEqual([])
    })

    it('builds a text avatar with the default user background', () => {
      const avatars = buildConversationAvatars(
        [makeParticipant({ participant_type: 'user', display_name: 'sean' })],
        () => undefined
      )

      expect(avatars).toEqual([
        { type: 'text', text: 'S', backgroundColor: '#6366f1', fallback: 'S' },
      ])
    })

    it('uses avatar_text for text but display_name for the fallback', () => {
      const avatars = buildConversationAvatars(
        [
          makeParticipant({
            participant_type: 'user',
            display_name: 'sean',
            avatar_text: 'Me',
            avatar_bg: '#000000',
          }),
        ],
        () => undefined
      )

      expect(avatars).toEqual([
        { type: 'text', text: 'Me', backgroundColor: '#000000', fallback: 'S' },
      ])
    })
  })

  it('skips unknown participant types', () => {
    const avatars = buildConversationAvatars(
      [makeParticipant({ participant_type: 'tool' })],
      () => undefined
    )

    expect(avatars).toEqual([])
  })

  it('preserves participant order across mixed types', () => {
    const avatars = buildConversationAvatars(
      [
        makeParticipant({ participant_type: 'user', display_name: 'sean' }),
        makeParticipant({ participant_type: 'model', participant_id: 'model-1' }),
        makeParticipant({ display_name: 'nova' }),
      ],
      (id) => (id === 'model-1' ? makeModel() : undefined)
    )

    expect(avatars.map((a) => a.type)).toEqual(['text', 'image', 'text'])
    expect(avatars[1].imageUrl).toBe(gptAvatar)
  })
})
