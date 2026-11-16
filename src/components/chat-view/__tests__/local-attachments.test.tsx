import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from '../MessageItem'
import { useMessageStore } from '@/stores/message'
import { toLocalAttachments } from '@/stores/message/crudActions'
import type { DisplayInfo } from '../hooks'
import type { Message, MessageResources } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const CONV = 'conv-local'
const DISPLAY: DisplayInfo = { displayName: 'Model', senderType: 'model' }
const getMessageDisplayInfo = () => DISPLAY
const noop = () => {}

const message: Message = {
  id: 'msg-1',
  conversation_id: CONV,
  sender_type: 'user',
  content: 'look at this',
  created_at: '2026-01-01T00:00:00Z',
}

function renderItem(messageResources: Record<string, MessageResources> = {}) {
  return render(
    <MessageItem
      message={message}
      prevUserMessage={null}
      messageResources={messageResources}
      urlStatuses={{}}
      getMessageDisplayInfo={getMessageDisplayInfo}
      onCopy={noop}
      onRevert={noop}
      onDeleteFromHere={noop}
      onRegenerate={noop}
      onFork={noop}
      onExportAll={noop}
      onExportConversation={noop}
      onExportMessage={noop}
    />
  )
}

function seedLocal() {
  const local = toLocalAttachments(
    message.id,
    [{ name: 'photo.png', base64: 'aGVsbG8=', mimeType: 'image/png' }],
    [{ name: 'notes.txt', content: 'hi', mimeType: 'text/plain' }]
  )
  useMessageStore.getState().getConversationState(CONV)
  useMessageStore.setState((s) => {
    s.conversationStates[CONV].localAttachments[message.id] = local
  })
}

const stored = (name: string): MessageResources['attachments'][number] => ({
  type: 'file',
  id: `att-${name}`,
  file_name: name,
  file_size: 5,
  mime_type: 'image/png',
  storage_path: `/store/${name}`,
  content_hash: 'h',
  created_at: message.created_at,
})

describe('just-sent user attachments', () => {
  beforeEach(() => {
    useMessageStore.setState({ conversationStates: {} })
  })

  it('shows the attachments as sent before their stored rows arrive', () => {
    seedLocal()
    renderItem()

    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('switches to the stored attachments once all of them are fetched', () => {
    seedLocal()
    renderItem({
      [message.id]: {
        attachments: [stored('stored-notes.txt'), stored('stored-photo.png')],
        contexts: [],
        steps: [],
      },
    })

    expect(screen.getByText('stored-photo.png')).toBeInTheDocument()
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument()
  })

  it('keeps the attachments as sent while only some are stored', () => {
    seedLocal()
    renderItem({
      [message.id]: { attachments: [stored('stored-notes.txt')], contexts: [], steps: [] },
    })

    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })
})
