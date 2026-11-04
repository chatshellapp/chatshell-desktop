import { beforeEach, describe, expect, it } from 'vitest'
import { usePermissionStore, type PermissionRequest } from '@/stores/permissionStore'

function request(requestId: string, conversationId: string): PermissionRequest {
  return {
    requestId,
    conversationId,
    toolName: 'bash',
    subject: 'cargo test',
    tier: 'exec',
    grant: null,
  }
}

describe('permissionStore', () => {
  beforeEach(() => {
    usePermissionStore.getState().reset()
  })

  it('queues requests in arrival order', () => {
    const store = usePermissionStore.getState()
    store.show(request('a1', 'conv-a'))
    store.show(request('b1', 'conv-b'))
    expect(usePermissionStore.getState().pending.map((r) => r.requestId)).toEqual(['a1', 'b1'])
  })

  it('removes a single request by id', () => {
    const store = usePermissionStore.getState()
    store.show(request('a1', 'conv-a'))
    store.show(request('a2', 'conv-a'))
    store.remove('a1')
    expect(usePermissionStore.getState().pending.map((r) => r.requestId)).toEqual(['a2'])
  })

  it('clearing a stopped conversation keeps other conversations pending', () => {
    const store = usePermissionStore.getState()
    store.show(request('a1', 'conv-a'))
    store.show(request('b1', 'conv-b'))
    store.show(request('a2', 'conv-a'))
    store.clearConversation('conv-a')
    expect(usePermissionStore.getState().pending.map((r) => r.requestId)).toEqual(['b1'])
  })

  it('reset drops every request', () => {
    const store = usePermissionStore.getState()
    store.show(request('a1', 'conv-a'))
    store.show(request('b1', 'conv-b'))
    store.reset()
    expect(usePermissionStore.getState().pending).toEqual([])
  })
})
