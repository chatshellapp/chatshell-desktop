import { toPng } from 'html-to-image'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
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

async function inlineAssetImages(
  element: HTMLElement
): Promise<Array<{ img: HTMLImageElement; originalSrc: string }>> {
  const restorations: Array<{ img: HTMLImageElement; originalSrc: string }> = []
  const images = element.querySelectorAll<HTMLImageElement>('img[data-storage-path]')

  await Promise.all(
    Array.from(images).map(async (img) => {
      const storagePath = img.dataset.storagePath
      if (!storagePath) return
      try {
        const b64 = await invoke<string>('read_image_base64', { storagePath })
        const ext = storagePath.split('.').pop()?.toLowerCase() ?? 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
        restorations.push({ img, originalSrc: img.src })
        img.src = `data:${mime};base64,${b64}`
      } catch {
        // leave original src if base64 load fails
      }
    })
  )

  return restorations
}

async function renderElementToImage(
  element: HTMLElement,
  paddingPx: number
): Promise<HTMLImageElement | null> {
  const restorations = await inlineAssetImages(element)

  const rect = element.getBoundingClientRect()
  const contentWidth = rect.width + paddingPx * 2
  const contentHeight = rect.height + paddingPx * 2
  const bg = getBackgroundColor()

  let dataUrl: string
  try {
    dataUrl = await toPng(element, {
      pixelRatio: SCREENSHOT_SCALE,
      backgroundColor: bg,
      width: contentWidth,
      height: contentHeight,
      style: {
        margin: '0',
        padding: `${paddingPx}px`,
        width: `${contentWidth}px`,
      },
      filter: (node: HTMLElement) => {
        if (node.dataset?.screenshotExclude === 'true') return false
        return true
      },
    })
  } finally {
    for (const { img, originalSrc } of restorations) {
      img.src = originalSrc
    }
  }

  try {
    return await loadImage(dataUrl)
  } catch {
    return null
  }
}

async function composeWithFooter(
  images: HTMLImageElement[],
  outerPaddingPx: number
): Promise<Uint8Array | null> {
  if (images.length === 0) return null

  const bg = getBackgroundColor()
  const outerPadding = outerPaddingPx * SCREENSHOT_SCALE
  const maxWidth = Math.max(...images.map((i) => i.width))
  const totalImageHeight = images.reduce((sum, i) => sum + i.height, 0)

  const canvas = document.createElement('canvas')
  canvas.width = maxWidth + outerPadding * 2
  canvas.height = totalImageHeight + outerPadding * 2 + FOOTER_HEIGHT * SCREENSHOT_SCALE
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let y = outerPadding
  for (const img of images) {
    const x = outerPadding + (maxWidth - img.width) / 2
    ctx.drawImage(img, x, y)
    y += img.height
  }

  await drawBrandFooter(ctx, y + outerPadding, canvas.width)

  const finalUrl = canvas.toDataURL('image/png')
  const base64 = finalUrl.split(',')[1]
  if (!base64) return null
  return base64ToUint8Array(base64)
}

async function captureElement(element: HTMLElement): Promise<Uint8Array | null> {
  try {
    const img = await renderElementToImage(element, SCREENSHOT_PADDING)
    if (!img) return null
    return await composeWithFooter([img], 0)
  } catch (err) {
    logger.error('Failed to capture element:', err)
    return null
  }
}

async function captureElements(elements: HTMLElement[]): Promise<Uint8Array | null> {
  if (elements.length === 0) return null
  if (elements.length === 1) return captureElement(elements[0])

  try {
    const images: HTMLImageElement[] = []
    for (const el of elements) {
      const img = await renderElementToImage(el, 0)
      if (!img) return null
      images.push(img)
    }
    return await composeWithFooter(images, SCREENSHOT_PADDING)
  } catch (err) {
    logger.error('Failed to capture elements:', err)
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

async function promptAndWriteScreenshot(data: Uint8Array): Promise<boolean> {
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

export async function saveScreenshot(element: HTMLElement): Promise<boolean> {
  const data = await captureElement(element)
  if (!data) return false
  return promptAndWriteScreenshot(data)
}

export async function saveScreenshotMulti(elements: HTMLElement[]): Promise<boolean> {
  const data = await captureElements(elements)
  if (!data) return false
  return promptAndWriteScreenshot(data)
}

export function findMessageElement(messageId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
}

export function findStreamingMessageElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-streaming-message="true"]')
}
