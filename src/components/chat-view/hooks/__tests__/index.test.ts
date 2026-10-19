import { describe, it, expect } from 'vitest'
import * as chatViewHooks from '../index'

describe('chat-view hooks barrel', () => {
  it('exports the public hook surface', () => {
    expect(typeof chatViewHooks.useScrollBehavior).toBe('function')
    expect(typeof chatViewHooks.useInputResize).toBe('function')
    expect(typeof chatViewHooks.useMessageResources).toBe('function')
    expect(typeof chatViewHooks.useDisplayInfo).toBe('function')
    expect(typeof chatViewHooks.useConversationState).toBe('function')
    expect(typeof chatViewHooks.useMessageHandlers).toBe('function')
  })
})
