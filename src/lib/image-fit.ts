// Provider image limits, applied at attach time so oversized images never
// cross IPC or sit in React state. Mirrors the backend ladder in
// chatshell-agent-core `image_fit.rs` (which stays the floor for every
// path that reaches a provider): longest side 2000 px, 5 MB of base64,
// PNG/JPEG/GIF/WebP only. Images that already fit pass through untouched.

export const IMAGE_MAX_SIDE = 2000
export const IMAGE_MAX_BASE64_CHARS = 5 * 1024 * 1024
const JPEG_QUALITIES = [0.85, 0.7, 0.55, 0.4]
const SCALE_STEP = 0.75
const MIN_SIDE = 200
const PROVIDER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export interface FittedImage {
  /** `data:<mime>;base64,<data>` */
  dataUrl: string
  mimeType: string
  /** Decoded byte size of the fitted image. */
  size: number
  resized: boolean
}

/** Base64 length of `bytes` raw bytes. */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Scale `width`x`height` so the longest side is at most `maxSide`. */
export function fitDimensions(
  width: number,
  height: number,
  maxSide: number
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width, height }
  const scale = maxSide / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Whether an image must be re-encoded before it can be sent. */
export function needsFit(image: {
  width: number
  height: number
  bytes: number
  mimeType: string
}): boolean {
  return (
    !PROVIDER_MIME_TYPES.includes(image.mimeType.toLowerCase()) ||
    Math.max(image.width, image.height) > IMAGE_MAX_SIDE ||
    base64Length(image.bytes) > IMAGE_MAX_BASE64_CHARS
  )
}

/** The quality ladder: `[mimeType, quality]` steps tried at each size. */
export function encodeSteps(mayHaveAlpha: boolean): Array<[string, number | undefined]> {
  const jpeg = JPEG_QUALITIES.map((q): [string, number | undefined] => ['image/jpeg', q])
  return mayHaveAlpha ? [['image/png', undefined], ...jpeg] : jpeg
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function original(bytes: Uint8Array, mimeType: string): FittedImage {
  return {
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    mimeType,
    size: bytes.length,
    resized: false,
  }
}

async function encodeCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mimeType: string,
  quality: number | undefined
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  if (mimeType === 'image/jpeg') {
    // JPEG has no alpha: composite onto white instead of black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(bitmap, 0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality))
}

/**
 * Fit image bytes to the provider limits. Falls back to the original bytes
 * when the image cannot be decoded here (the backend ladder still applies).
 */
export async function fitImage(bytes: Uint8Array, mimeType: string): Promise<FittedImage> {
  if (typeof createImageBitmap !== 'function') return original(bytes, mimeType)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }))
  } catch {
    return original(bytes, mimeType)
  }
  try {
    if (!needsFit({ width: bitmap.width, height: bitmap.height, bytes: bytes.length, mimeType })) {
      return original(bytes, mimeType)
    }
    const mayHaveAlpha = mimeType !== 'image/jpeg'
    let side = Math.min(Math.max(bitmap.width, bitmap.height), IMAGE_MAX_SIDE)
    while (side >= MIN_SIDE) {
      const { width, height } = fitDimensions(bitmap.width, bitmap.height, side)
      for (const [type, quality] of encodeSteps(mayHaveAlpha)) {
        const blob = await encodeCanvas(bitmap, width, height, type, quality)
        if (!blob) return original(bytes, mimeType)
        if (base64Length(blob.size) <= IMAGE_MAX_BASE64_CHARS) {
          const encoded = new Uint8Array(await blob.arrayBuffer())
          return {
            dataUrl: `data:${type};base64,${bytesToBase64(encoded)}`,
            mimeType: type,
            size: encoded.length,
            resized: true,
          }
        }
      }
      side = Math.floor(side * SCALE_STEP)
    }
    return original(bytes, mimeType)
  } finally {
    bitmap.close()
  }
}
