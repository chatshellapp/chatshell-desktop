import { describe, it, expect } from 'vitest'
import {
  IMAGE_MAX_BASE64_CHARS,
  base64Length,
  encodeSteps,
  fitDimensions,
  fitImage,
  needsFit,
} from '../image-fit'

describe('image-fit', () => {
  it('scales the longest side down to the limit and keeps small images', () => {
    expect(fitDimensions(4000, 1000, 2000)).toEqual({ width: 2000, height: 500 })
    expect(fitDimensions(1000, 3000, 2000)).toEqual({ width: 667, height: 2000 })
    expect(fitDimensions(800, 600, 2000)).toEqual({ width: 800, height: 600 })
  })

  it('needs a fit for oversized, overweight, or provider-unsupported images', () => {
    const ok = { width: 1200, height: 800, bytes: 100_000, mimeType: 'image/png' }
    expect(needsFit(ok)).toBe(false)
    expect(needsFit({ ...ok, width: 2400 })).toBe(true)
    expect(needsFit({ ...ok, bytes: (IMAGE_MAX_BASE64_CHARS / 4) * 3 + 3 })).toBe(true)
    expect(needsFit({ ...ok, mimeType: 'image/bmp' })).toBe(true)
  })

  it('tries PNG first only when the source may carry transparency', () => {
    expect(encodeSteps(true)[0]).toEqual(['image/png', undefined])
    expect(encodeSteps(false).every(([type]) => type === 'image/jpeg')).toBe(true)
  })

  it('computes base64 length like the encoder', () => {
    expect(base64Length(3)).toBe(4)
    expect(base64Length(4)).toBe(8)
  })

  it('passes undecodable bytes through unchanged for the backend floor', async () => {
    const fitted = await fitImage(new Uint8Array([0, 1, 2]), 'image/png')
    expect(fitted).toEqual({
      dataUrl: 'data:image/png;base64,AAEC',
      mimeType: 'image/png',
      size: 3,
      resized: false,
    })
  })
})
