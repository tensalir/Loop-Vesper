/**
 * Client-side PDF image extraction using pdf.js.
 *
 * Hybrid approach:
 * 1. Extract embedded images from the PDF (fast, preserves original quality)
 * 2. Fallback: render pages as bitmaps and extract candidate regions
 */

type PDFDocumentProxy = any
type PDFPageProxy = any
const PDFJS_VERSION = '5.4.624'

let pdfjsReady: Promise<{ getDocument: any; OPS: any; version: string }> | null = null

function getPdfjs() {
  if (pdfjsReady) return pdfjsReady

  pdfjsReady = (async () => {
    try {
      const moduleUrls = [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.min.mjs',
        'https://unpkg.com/pdfjs-dist@5.4.624/build/pdf.min.mjs',
      ] as const
      let pdfjsModule: any = null
      let selectedModuleUrl: string | null = null
      let lastImportError: unknown = null

      for (const moduleUrl of moduleUrls) {
        try {
          pdfjsModule = await import(/* webpackIgnore: true */ moduleUrl)
          selectedModuleUrl = moduleUrl
          break
        } catch (importError: any) {
          lastImportError = importError
        }
      }

      if (!pdfjsModule || !selectedModuleUrl) {
        throw lastImportError ?? new Error('Unable to import pdfjs from CDN')
      }

      const {
        getDocument: pdfjsGetDocument,
        GlobalWorkerOptions: pdfjsGlobalWorkerOptions,
        OPS: pdfjsOPS,
        version: pdfjsVersion,
      } = pdfjsModule

      if (typeof window !== 'undefined' && pdfjsGlobalWorkerOptions && !pdfjsGlobalWorkerOptions.workerSrc) {
        pdfjsGlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`
        console.log(`[pdf-extraction] Worker configured: pdfjs-dist@${pdfjsVersion}`)
      }

      return { getDocument: pdfjsGetDocument, OPS: pdfjsOPS, version: pdfjsVersion }
    } catch (error: any) {
      throw error
    }
  })()

  return pdfjsReady
}

export interface ExtractedImage {
  blob: Blob
  file: File
  width: number
  height: number
  pageIndex: number
  source: 'embedded' | 'rendered' | 'segmented'
}

export interface ExtractionProgress {
  phase: 'loading' | 'extracting' | 'rendering' | 'complete' | 'error'
  currentPage: number
  totalPages: number
  imagesFound: number
  message: string
}

export type ProgressCallback = (progress: ExtractionProgress) => void

const MIN_IMAGE_DIMENSION = 64
const MIN_IMAGE_AREA = 64 * 64

async function loadDocument(file: File): Promise<PDFDocumentProxy> {
  const { getDocument } = await getPdfjs()
  const arrayBuffer = await file.arrayBuffer()
  console.log('[pdf-extraction] Loading PDF document...')
  const loadingTask = getDocument({
    data: arrayBuffer,
    // Ensure image/font decoders are available when using CDN-loaded pdf.js.
    cMapUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`,
    wasmUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/wasm/`,
    iccUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/iccs/`,
  })
  const doc = await loadingTask.promise
  console.log(`[pdf-extraction] Loaded: ${doc.numPages} pages`)
  return doc
}

/**
 * Try to extract embedded images from PDF operator streams.
 */
async function extractEmbeddedImages(
  doc: PDFDocumentProxy,
  onProgress?: ProgressCallback
): Promise<ExtractedImage[]> {
  const { OPS } = await getPdfjs()
  const results: ExtractedImage[] = []
  const numPages = doc.numPages
  const seenKeys = new Set<string>()

  for (let i = 1; i <= numPages; i++) {
    onProgress?.({
      phase: 'extracting',
      currentPage: i,
      totalPages: numPages,
      imagesFound: results.length,
      message: `Scanning page ${i}/${numPages} for embedded images...`,
    })

    let page: PDFPageProxy
    try {
      page = await doc.getPage(i)
    } catch (err) {
      console.warn(`[pdf-extraction] Failed to get page ${i}:`, err)
      continue
    }

    let ops: any
    try {
      ops = await page.getOperatorList()
    } catch (err) {
      console.warn(`[pdf-extraction] Failed to get operator list for page ${i}:`, err)
      page.cleanup()
      continue
    }

    console.log(`[pdf-extraction] Page ${i}: ${ops.fnArray.length} operators`)

    for (let j = 0; j < ops.fnArray.length; j++) {
      if (ops.fnArray[j] !== OPS.paintImageXObject) continue

      const imgName = ops.argsArray[j]?.[0]
      if (!imgName || seenKeys.has(imgName)) continue
      seenKeys.add(imgName)

      try {
        const imgData = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('timeout')), 5000)
          page.objs.get(imgName, (obj: any) => {
            clearTimeout(timeout)
            resolve(obj)
          })
        })

        if (!imgData) continue

        const w = imgData.width
        const h = imgData.height
        if (!w || !h || w < MIN_IMAGE_DIMENSION || h < MIN_IMAGE_DIMENSION || w * h < MIN_IMAGE_AREA) {
          continue
        }

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!

        if (imgData.bitmap) {
          ctx.drawImage(imgData.bitmap, 0, 0)
        } else if (imgData.data) {
          const imageData = ctx.createImageData(w, h)
          const src = imgData.data
          const dst = imageData.data

          if (imgData.kind === 2) {
            for (let p = 0, q = 0; p < src.length; p += 3, q += 4) {
              dst[q] = src[p]
              dst[q + 1] = src[p + 1]
              dst[q + 2] = src[p + 2]
              dst[q + 3] = 255
            }
          } else {
            dst.set(src.length === w * h * 4 ? src : expandGrayscale(src, w, h))
          }
          ctx.putImageData(imageData, 0, 0)
        } else {
          continue
        }

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png')
        )
        if (!blob) continue

        const imgFile = new File([blob], `pdf-embedded-p${i}-${results.length}.png`, {
          type: 'image/png',
        })

        console.log(`[pdf-extraction] Embedded image found on page ${i}: ${w}x${h}`)
        results.push({
          blob,
          file: imgFile,
          width: w,
          height: h,
          pageIndex: i - 1,
          source: 'embedded',
        })
      } catch (err) {
        console.warn(`[pdf-extraction] Failed to decode image ${imgName} on page ${i}:`, err)
      }
    }

    page.cleanup()
  }

  console.log(`[pdf-extraction] Embedded extraction complete: ${results.length} images`)
  return results
}

function expandGrayscale(src: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < src.length; i++, j += 4) {
    dst[j] = src[i]
    dst[j + 1] = src[i]
    dst[j + 2] = src[i]
    dst[j + 3] = 255
  }
  return dst
}

/**
 * Fallback: render each PDF page to a bitmap and return as a candidate image.
 */
async function renderPagesAsImages(
  doc: PDFDocumentProxy,
  onProgress?: ProgressCallback,
  scale = 2
): Promise<ExtractedImage[]> {
  const results: ExtractedImage[] = []
  const numPages = doc.numPages

  console.log(`[pdf-extraction] Rendering ${numPages} pages as images (scale=${scale})...`)

  for (let i = 1; i <= numPages; i++) {
    onProgress?.({
      phase: 'rendering',
      currentPage: i,
      totalPages: numPages,
      imagesFound: results.length,
      message: `Rendering page ${i}/${numPages}...`,
    })

    try {
      const page: PDFPageProxy = await doc.getPage(i)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!

      await page.render({ canvasContext: ctx, viewport }).promise

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      )
      if (!blob) {
        page.cleanup()
        continue
      }

      const imgFile = new File([blob], `pdf-page-${i}.png`, { type: 'image/png' })

      console.log(`[pdf-extraction] Rendered page ${i}: ${Math.round(viewport.width)}x${Math.round(viewport.height)}`)
      results.push({
        blob,
        file: imgFile,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        pageIndex: i - 1,
        source: 'rendered',
      })

      page.cleanup()
    } catch (err) {
      console.warn(`[pdf-extraction] Failed to render page ${i}:`, err)
    }
  }

  return results
}

/**
 * Main extraction pipeline.
 * Hybrid: tries embedded extraction first, falls back to page rendering
 * if fewer than `minEmbeddedThreshold` images are found.
 */
export async function extractImagesFromPdf(
  file: File,
  onProgress?: ProgressCallback,
  options?: {
    minEmbeddedThreshold?: number
    renderScale?: number
  }
): Promise<{ images: ExtractedImage[]; pageCount: number }> {
  const { minEmbeddedThreshold = 2, renderScale = 2 } = options ?? {}

  console.log(`[pdf-extraction] Starting extraction for: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`)

  onProgress?.({
    phase: 'loading',
    currentPage: 0,
    totalPages: 0,
    imagesFound: 0,
    message: 'Loading PDF...',
  })

  const doc = await loadDocument(file)
  const pageCount = doc.numPages

  let images = await extractEmbeddedImages(doc, onProgress)

  if (images.length < minEmbeddedThreshold) {
    console.log(`[pdf-extraction] Only ${images.length} embedded images (threshold: ${minEmbeddedThreshold}), falling back to page rendering`)
    const rendered = await renderPagesAsImages(doc, onProgress, renderScale)
    images = [...images, ...rendered]
  }

  onProgress?.({
    phase: 'complete',
    currentPage: pageCount,
    totalPages: pageCount,
    imagesFound: images.length,
    message: `Extracted ${images.length} image${images.length !== 1 ? 's' : ''} from ${pageCount} page${pageCount !== 1 ? 's' : ''}`,
  })

  console.log(`[pdf-extraction] Done: ${images.length} total images from ${pageCount} pages`)
  doc.destroy()

  return { images, pageCount }
}
