import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toPng } from 'html-to-image'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import {
  releaseContentVisibility,
  restoreContentVisibility,
  saveScreenshot,
  saveScreenshotMulti,
  findMessageElement,
  findStreamingMessageElement,
} from '../screenshot'

vi.mock('html-to-image', () => ({
  toPng: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockToPng = vi.mocked(toPng)
const mockSave = vi.mocked(save)
const mockWriteFile = vi.mocked(writeFile)
const mockInvoke = vi.mocked(invoke)
const RENDER_DATA_URL = 'data:image/png;base64,AAAA'
const ICON_SRC = '/chatshell-icon.png'

class FakeImage {
  static failSrcs = new Set<string>()
  static created: FakeImage[] = []

  width: number
  height: number
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  private currentSrc = ''

  constructor(width = 100, height = 40) {
    this.width = width
    this.height = height
    FakeImage.created.push(this)
  }

  get src() {
    return this.currentSrc
  }

  set src(value: string) {
    this.currentSrc = value
    queueMicrotask(() => {
      if (FakeImage.failSrcs.has(value)) {
        this.onerror?.(new Error(`failed to load ${value}`))
      } else {
        this.onload?.()
      }
    })
  }
}

function stubImage() {
  vi.stubGlobal('Image', FakeImage)
}

function stubCanvas(dataUrl = 'data:image/png;base64,QUJD') {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 6 }),
  }
  const canvases: HTMLCanvasElement[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    canvases.push(this)
    return ctx as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl)
  return { ctx, canvases }
}

function makeRow(chatMessageId: string): HTMLElement {
  const row = document.createElement('div')
  row.dataset.messageId = chatMessageId
  row.style.contentVisibility = 'auto'
  row.style.containIntrinsicSize = 'auto 120px'
  return row
}

function makeCaptureTarget(): HTMLElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return element
}

function loadedImageFor(src: string): FakeImage {
  const image = FakeImage.created.find((candidate) => candidate.src === src)
  expect(image, `expected an image instance for ${src}`).toBeDefined()
  return image as FakeImage
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeImage.created = []
  FakeImage.failSrcs.clear()
  mockToPng.mockResolvedValue(RENDER_DATA_URL)
  mockSave.mockResolvedValue('/tmp/shot.png')
  mockWriteFile.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.classList.remove('dark')
  document.body.innerHTML = ''
})

describe('screenshot capture visibility', () => {
  it('lays out culled message rows before capture and restores their culling', () => {
    const container = document.createElement('div')
    const first = makeRow('m1')
    const second = makeRow('m2')
    container.append(first, second)

    const restorations = releaseContentVisibility(container)

    expect(restorations).toHaveLength(2)
    expect(first.style.contentVisibility).toBe('visible')
    expect(second.style.contentVisibility).toBe('visible')
    expect(first.style.containIntrinsicSize).toBe('none')
    expect(second.style.containIntrinsicSize).toBe('none')

    restoreContentVisibility(restorations)

    expect(first.style.contentVisibility).toBe('auto')
    expect(second.style.contentVisibility).toBe('auto')
    expect(first.style.containIntrinsicSize).toBe('auto 120px')
    expect(second.style.containIntrinsicSize).toBe('auto 120px')
  })

  it('handles a single message row as the capture root', () => {
    const row = makeRow('m1')

    const restorations = releaseContentVisibility(row)

    expect(row.style.contentVisibility).toBe('visible')

    restoreContentVisibility(restorations)

    expect(row.style.contentVisibility).toBe('auto')
  })

  it('skips rows that are already laid out', () => {
    const container = document.createElement('div')
    const culled = makeRow('m1')
    const visible = makeRow('m2')
    visible.style.contentVisibility = 'visible'
    const plain = document.createElement('div')
    container.append(culled, visible, plain)

    const restorations = releaseContentVisibility(container)

    expect(restorations).toHaveLength(1)
    restoreContentVisibility(restorations)

    expect(culled.style.contentVisibility).toBe('auto')
    expect(visible.style.contentVisibility).toBe('visible')
  })

  it('does not restore the same row twice when it is both root and descendant', () => {
    const row = makeRow('m1')
    const inner = makeRow('m2')
    row.appendChild(inner)

    const restorations = releaseContentVisibility(row)

    expect(restorations).toHaveLength(2)
    expect(restorations.map((r) => r.element)).toEqual([row, inner])
  })
})

describe('findMessageElement', () => {
  it('finds the element carrying the message id', () => {
    const row = makeRow('msg-42')
    document.body.appendChild(row)

    expect(findMessageElement('msg-42')).toBe(row)
  })

  it('returns null when no element matches', () => {
    document.body.appendChild(makeRow('other'))

    expect(findMessageElement('missing')).toBeNull()
  })
})

describe('findStreamingMessageElement', () => {
  it('finds the element marked as streaming', () => {
    const row = document.createElement('div')
    row.dataset.streamingMessage = 'true'
    document.body.appendChild(row)

    expect(findStreamingMessageElement()).toBe(row)
  })

  it('returns null when nothing is streaming', () => {
    expect(findStreamingMessageElement()).toBeNull()
  })
})

describe('saveScreenshot', () => {
  it('captures, composes with the brand footer and writes the chosen file', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    stubImage()
    const { ctx, canvases } = stubCanvas()
    const element = makeCaptureTarget()

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(toPng).toHaveBeenCalledTimes(1)
    expect(mockToPng.mock.calls[0][0]).toBe(element)

    const options = mockToPng.mock.calls[0][1]!
    expect(options.pixelRatio).toBe(2)
    expect(options.backgroundColor).toBe('#ffffff')
    expect(options.width).toBe(48)
    expect(options.height).toBe(48)
    expect(options.style?.padding).toBe('24px')
    expect(options.style?.margin).toBe('0')
    expect(
      options.filter?.({ dataset: { screenshotExclude: 'true' } } as unknown as HTMLElement)
    ).toBe(false)
    expect(options.filter?.({} as unknown as HTMLElement)).toBe(true)

    expect(canvases).toHaveLength(1)
    expect(canvases[0].width).toBe(100)
    expect(canvases[0].height).toBe(40 + 40 * 2)

    const contentImage = loadedImageFor(RENDER_DATA_URL)
    const iconImage = loadedImageFor(ICON_SRC)
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, contentImage, 0, 0)
    expect(ctx.drawImage).toHaveBeenNthCalledWith(
      2,
      iconImage,
      expect.any(Number),
      expect.any(Number),
      32,
      32
    )
    expect(ctx.fillText).toHaveBeenCalledWith('ChatShell', expect.any(Number), expect.any(Number))
    expect(ctx.fillText).toHaveBeenCalledWith(
      'chatshell.app',
      expect.any(Number),
      expect.any(Number)
    )

    expect(save).toHaveBeenCalledTimes(1)
    expect(mockSave.mock.calls[0][0]).toEqual({
      defaultPath: expect.stringMatching(/^chatshell-\d{8}-aaaa\.png$/),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith('/tmp/shot.png', new Uint8Array([65, 66, 67]))
  })

  it('uses dark colors when the document root has the dark class', async () => {
    document.documentElement.classList.add('dark')
    FakeImage.failSrcs.add(ICON_SRC)
    stubImage()
    const { ctx } = stubCanvas()
    const element = makeCaptureTarget()

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(mockToPng.mock.calls[0][1]!.backgroundColor).toBe('#09090b')
    expect(ctx.strokeStyle).toBe('rgba(255,255,255,0.1)')
    // The footer text still renders when the brand icon fails to load
    expect(ctx.fillText).toHaveBeenCalledWith('ChatShell', expect.any(Number), expect.any(Number))
  })

  it('returns false and logs when the renderer throws', async () => {
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()
    mockToPng.mockRejectedValue(new Error('render boom'))

    const result = await saveScreenshot(element)

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('Failed to capture element:', expect.any(Error))
    expect(save).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('returns false when the rendered data url cannot be loaded as an image', async () => {
    stubImage()
    stubCanvas()
    FakeImage.failSrcs.add(RENDER_DATA_URL)
    const element = makeCaptureTarget()

    const result = await saveScreenshot(element)

    expect(result).toBe(false)
    expect(logger.error).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('returns false without writing when the save dialog is cancelled', async () => {
    stubImage()
    stubCanvas()
    mockSave.mockResolvedValue(null)
    const element = makeCaptureTarget()

    const result = await saveScreenshot(element)

    expect(result).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('returns false and logs when writing the file fails', async () => {
    stubImage()
    stubCanvas()
    mockWriteFile.mockRejectedValue(new Error('disk full'))
    const element = makeCaptureTarget()

    const result = await saveScreenshot(element)

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('Failed to save screenshot:', expect.any(Error))
  })

  it('returns false when the composed canvas has no base64 payload', async () => {
    stubImage()
    stubCanvas('not-a-data-url')
    const element = makeCaptureTarget()

    const result = await saveScreenshot(element)

    expect(result).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('waits a frame for culled rows and restores them after capture', async () => {
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('requestAnimationFrame', raf)
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()
    const row = makeRow('m1')
    element.appendChild(row)
    let visibilityDuringRender = ''
    let intrinsicDuringRender = ''
    mockToPng.mockImplementation(async () => {
      visibilityDuringRender = row.style.contentVisibility
      intrinsicDuringRender = row.style.containIntrinsicSize
      return RENDER_DATA_URL
    })

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(raf).toHaveBeenCalledTimes(1)
    expect(visibilityDuringRender).toBe('visible')
    expect(intrinsicDuringRender).toBe('none')
    expect(row.style.contentVisibility).toBe('auto')
    expect(row.style.containIntrinsicSize).toBe('auto 120px')
  })
})

describe('saveScreenshot attachment inlining', () => {
  function makeAttachmentImage(storagePath: string): HTMLImageElement {
    const img = document.createElement('img')
    img.dataset.storagePath = storagePath
    img.src = `https://cdn.example/${storagePath}`
    return img
  }

  it('inlines base64 attachment images during capture and restores them after', async () => {
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()
    const img = makeAttachmentImage('attachments/photo.jpg')
    element.appendChild(img)
    mockInvoke.mockResolvedValue('aGVsbG8=')
    let srcDuringRender = ''
    mockToPng.mockImplementation(async () => {
      srcDuringRender = img.src
      return RENDER_DATA_URL
    })

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(invoke).toHaveBeenCalledWith('read_image_base64', {
      storagePath: 'attachments/photo.jpg',
    })
    expect(srcDuringRender).toBe('data:image/jpeg;base64,aGVsbG8=')
    expect(img.src).toBe('https://cdn.example/attachments/photo.jpg')
  })

  it('keeps the original src when the base64 read fails', async () => {
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()
    const img = makeAttachmentImage('attachments/photo.jpg')
    element.appendChild(img)
    mockInvoke.mockRejectedValue(new Error('asset gone'))

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(img.src).toBe('https://cdn.example/attachments/photo.jpg')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('skips images whose storage path is empty', async () => {
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()
    const img = document.createElement('img')
    img.dataset.storagePath = ''
    element.appendChild(img)

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('maps file extensions to mime types when inlining', async () => {
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()
    const paths = ['a.jpg', 'b.JPEG', 'c.PNG', 'd.svg']
    const imgs = paths.map((path) => makeAttachmentImage(path))
    imgs.forEach((img) => element.appendChild(img))
    mockInvoke.mockResolvedValue('aGVsbG8=')
    const srcsDuringRender: string[] = []
    mockToPng.mockImplementation(async () => {
      srcsDuringRender.push(...imgs.map((img) => img.src))
      return RENDER_DATA_URL
    })

    const result = await saveScreenshot(element)

    expect(result).toBe(true)
    expect(srcsDuringRender).toEqual([
      'data:image/jpeg;base64,aGVsbG8=',
      'data:image/jpeg;base64,aGVsbG8=',
      'data:image/png;base64,aGVsbG8=',
      'data:image/svg;base64,aGVsbG8=',
    ])
    imgs.forEach((img, index) => {
      expect(img.src).toBe(`https://cdn.example/${paths[index]}`)
    })
  })
})

describe('saveScreenshotMulti', () => {
  it('returns false immediately for an empty element list', async () => {
    const result = await saveScreenshotMulti([])

    expect(result).toBe(false)
    expect(toPng).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('captures a single element through the padded single-capture path', async () => {
    stubImage()
    stubCanvas()
    const element = makeCaptureTarget()

    const result = await saveScreenshotMulti([element])

    expect(result).toBe(true)
    expect(toPng).toHaveBeenCalledTimes(1)
    expect(mockToPng.mock.calls[0][1]!.style?.padding).toBe('24px')
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('composes multiple captures into a single canvas with outer padding', async () => {
    stubImage()
    const { ctx, canvases } = stubCanvas()
    const first = makeCaptureTarget()
    const second = makeCaptureTarget()

    const result = await saveScreenshotMulti([first, second])

    expect(result).toBe(true)
    expect(toPng).toHaveBeenCalledTimes(2)
    expect(mockToPng.mock.calls[0][0]).toBe(first)
    expect(mockToPng.mock.calls[1][0]).toBe(second)
    expect(mockToPng.mock.calls[0][1]!.style?.padding).toBe('0px')
    expect(mockToPng.mock.calls[1][1]!.style?.padding).toBe('0px')

    expect(canvases).toHaveLength(1)
    expect(canvases[0].width).toBe(100 + 24 * 2 * 2)
    expect(canvases[0].height).toBe(40 * 2 + 24 * 2 * 2 + 40 * 2)

    const renderImages = FakeImage.created.filter((candidate) => candidate.src === RENDER_DATA_URL)
    expect(renderImages).toHaveLength(2)
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, renderImages[0], 48, 48)
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, renderImages[1], 48, 48 + 40)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('returns false when any element fails to render', async () => {
    stubImage()
    stubCanvas()
    FakeImage.failSrcs.add(RENDER_DATA_URL)
    const first = makeCaptureTarget()
    const second = makeCaptureTarget()

    const result = await saveScreenshotMulti([first, second])

    expect(result).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('returns false and logs when multi capture throws', async () => {
    stubImage()
    stubCanvas()
    mockToPng.mockRejectedValue(new Error('render boom'))
    const first = makeCaptureTarget()
    const second = makeCaptureTarget()

    const result = await saveScreenshotMulti([first, second])

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('Failed to capture elements:', expect.any(Error))
    expect(save).not.toHaveBeenCalled()
  })
})
