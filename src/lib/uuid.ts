// UUID v7 (RFC 9562): 48-bit Unix millisecond timestamp, then version,
// variant and random bits. Matches the backend's `Uuid::now_v7()`.
export function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const ms = Date.now()
  for (let i = 0; i < 6; i++) {
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
