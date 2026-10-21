import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAttachmentState } from '../useAttachmentState'

describe('useAttachmentState', () => {
  it('starts with an empty attachment list', () => {
    const { result } = renderHook(() => useAttachmentState())

    expect(result.current.attachments).toEqual([])
  })

  it('addAttachment appends with a type-prefixed timestamp id', () => {
    const { result } = renderHook(() => useAttachmentState())

    act(() => result.current.addAttachment('file', 'notes.md'))
    act(() => result.current.addAttachment('image', 'pic.png'))

    const [first, second] = result.current.attachments
    expect(first).toMatchObject({ type: 'file', name: 'notes.md' })
    expect(first.id).toMatch(/^file-\d+-\d+$/)
    expect(second).toMatchObject({ type: 'image', name: 'pic.png' })
    expect(second.id).toMatch(/^image-\d+-\d+$/)
  })

  it('keeps duplicate names and types — no dedup by design', () => {
    const { result } = renderHook(() => useAttachmentState())

    act(() => result.current.addAttachment('file', 'same.md'))
    act(() => result.current.addAttachment('file', 'same.md'))

    expect(result.current.attachments).toHaveLength(2)
  })

  it('removeAttachment filters out only the matching id', () => {
    const { result } = renderHook(() => useAttachmentState())

    act(() => result.current.addAttachment('file', 'a.md'))
    act(() => result.current.addAttachment('file', 'b.md'))
    const doomed = result.current.attachments[0]

    act(() => result.current.removeAttachment(doomed.id))

    expect(result.current.attachments).toHaveLength(1)
    expect(result.current.attachments[0].name).toBe('b.md')
  })

  it('two same-type attachments added in one millisecond keep distinct ids', () => {
    const { result } = renderHook(() => useAttachmentState())
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)

    try {
      act(() => result.current.addAttachment('file', 'a.md'))
      act(() => result.current.addAttachment('file', 'b.md'))

      const [first, second] = result.current.attachments
      expect(first.id).not.toBe(second.id)

      act(() => result.current.removeAttachment(first.id))
      expect(result.current.attachments).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })

  it('removeAttachment with an unknown id is a no-op', () => {
    const { result } = renderHook(() => useAttachmentState())

    act(() => result.current.addAttachment('file', 'a.md'))
    act(() => result.current.removeAttachment('file-999'))

    expect(result.current.attachments).toHaveLength(1)
  })

  it('clearAttachments empties the list', () => {
    const { result } = renderHook(() => useAttachmentState())

    act(() => result.current.addAttachment('file', 'a.md'))
    act(() => result.current.addAttachment('image', 'b.png'))
    act(() => result.current.clearAttachments())

    expect(result.current.attachments).toEqual([])
  })

  it('setAttachments passthrough supports direct and functional updates', () => {
    const { result } = renderHook(() => useAttachmentState())

    act(() => result.current.setAttachments([{ id: 'x', type: 'file', name: 'x.md' }]))
    act(() =>
      result.current.setAttachments((prev) => [...prev, { id: 'y', type: 'file', name: 'y.md' }])
    )

    expect(result.current.attachments.map((a) => a.id)).toEqual(['x', 'y'])
  })

  it('callbacks keep stable identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useAttachmentState())
    const first = result.current

    rerender()

    expect(result.current.addAttachment).toBe(first.addAttachment)
    expect(result.current.removeAttachment).toBe(first.removeAttachment)
    expect(result.current.clearAttachments).toBe(first.clearAttachments)
    expect(result.current.setAttachments).toBe(first.setAttachments)
  })
})
