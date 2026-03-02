import { toPng } from 'html-to-image'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { logger } from '@/lib/logger'

const SCREENSHOT_PADDING = 24
const SCREENSHOT_SCALE = 2
const FOOTER_HEIGHT = 40
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

function getBackgroundColor(): string {
  return isDarkMode() ? '#09090b' : '#ffffff'
}

function base64ToUint8Array(base64: string): Uint8Array {
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i)
  }
  return arr
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function drawBrandFooter(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number
): Promise<void> {
  const s = SCREENSHOT_SCALE
  const dark = isDarkMode()
  const bg = getBackgroundColor()

  ctx.fillStyle = bg
  ctx.fillRect(0, y, width, FOOTER_HEIGHT * s)

  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  ctx.lineWidth = s
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(width, y)
  ctx.stroke()

  const fontSize = 12 * s
  const centerX = width / 2
  const centerY = y + (FOOTER_HEIGHT * s) / 2

  const nameColor = dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)'
  const dotColor = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  const urlColor = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'

  const boldFont = `600 ${fontSize}px ${FONT_FAMILY}`
  const normalFont = `400 ${fontSize}px ${FONT_FAMILY}`

  const logoSize = 16 * s
  const logoGap = 6 * s

  ctx.font = boldFont
  const nameText = 'ChatShell'
  const nameW = ctx.measureText(nameText).width

  ctx.font = normalFont
  const sepText = '  \u00B7  '
  const sepW = ctx.measureText(sepText).width
  const urlText = 'chatshell.app'
  const urlW = ctx.measureText(urlText).width

  const totalW = logoSize + logoGap + nameW + sepW + urlW
  let x = centerX - totalW / 2

  try {
    const logo = await loadImage('/chatshell-icon.png')
    const logoY = centerY - logoSize / 2
    ctx.drawImage(logo, x, logoY, logoSize, logoSize)
  } catch {
    // fallback: skip logo if load fails
  }
  x += logoSize + logoGap

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = nameColor
  ctx.font = boldFont
  ctx.fillText(nameText, x, centerY)
  x += nameW

  ctx.fillStyle = dotColor
  ctx.font = normalFont
  ctx.fillText(sepText, x, centerY)
  x += sepW

  ctx.fillStyle = urlColor
  ctx.font = normalFont
  ctx.fillText(urlText, x, centerY)
}

async function captureElement(element: HTMLElement): Promise<Uint8Array | null> {
  try {
    const rect = element.getBoundingClientRect()
    const contentWidth = rect.width + SCREENSHOT_PADDING * 2
    const contentHeight = rect.height + SCREENSHOT_PADDING * 2
    const bg = getBackgroundColor()

    const dataUrl = await toPng(element, {
      pixelRatio: SCREENSHOT_SCALE,
      backgroundColor: bg,
      width: contentWidth,
      height: contentHeight,
      style: {
        margin: '0',
        padding: `${SCREENSHOT_PADDING}px`,
        width: `${contentWidth}px`,
      },
      filter: (node: HTMLElement) => {
        if (node.dataset?.screenshotExclude === 'true') return false
        return true
      },
    })

    const img = await loadImage(dataUrl)

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height + FOOTER_HEIGHT * SCREENSHOT_SCALE
    const ctx = canvas.getContext('2d')!

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    await drawBrandFooter(ctx, img.height, canvas.width)

    const finalUrl = canvas.toDataURL('image/png')
    const base64 = finalUrl.split(',')[1]
    if (!base64) return null
    return base64ToUint8Array(base64)
  } catch (err) {
    logger.error('Failed to capture element:', err)
    return null
  }
}

function generateFilename(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  let suffix = ''
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return `chatshell-${y}${m}${d}-${suffix}.png`
}

export async function saveScreenshot(element: HTMLElement): Promise<boolean> {
  const data = await captureElement(element)
  if (!data) return false

  try {
    const filePath = await save({
      defaultPath: generateFilename(),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    })
    if (!filePath) return false

    await writeFile(filePath, data)
    return true
  } catch (err) {
    logger.error('Failed to save screenshot:', err)
    return false
  }
}

export function findMessageElement(messageId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
}
