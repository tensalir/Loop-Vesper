/**
 * A PDF's text as lines per page, the way the plugin repository's `spec_diff.py` reads it with
 * pypdf (`pdf_pages`: `extract_text()`, split on newlines, each line trimmed, blank lines dropped),
 * so the ported spec check reads the same page Damien's scripts read.
 *
 * pypdf ends a line at each text object; pdf.js does not say where one ends, but it marks the start
 * of one with an empty end-of-line item and fills the gap between two objects on one row with a
 * whitespace-only item as wide as the gap. So: an empty item ends the line; a whitespace-only item
 * wider than about one and a half times the font size ends it too (two objects, a label and its
 * value); a narrower one is a word space and stays; a non-empty end-of-line item inside one object
 * is a wrapped line, which pypdf keeps on one line joined by a space.
 *
 * Proved on Vesper's export of 2026-09-22 (spec case `2026-09-22-experience2cc-vesper`): 333 of
 * 333 lines on five pages equal pypdf's once runs of whitespace are one space
 * (`tests/cmf-pdf-lines.spec.ts`, when the PDF is on the machine). A layout it has not seen is
 * checked the same way before it is trusted: `cmf_check_pdf` can also run the repository's own
 * script through the creative worker.
 */

type PdfTextItem = { str?: unknown; hasEOL?: boolean; width?: number; height?: number; transform?: number[] }

/** How wide a whitespace-only item may be, in font sizes, before it is a gap between two objects. */
export const GAP_FONT_SIZES = 1.5

/** One page's items → its lines, by the rule above. Pure, for the tests. */
export function linesFromItems(items: readonly PdfTextItem[]): string[] {
  const lines: string[] = []
  let cur = ''
  const flush = () => {
    if (cur) lines.push(cur)
    cur = ''
  }
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    if (item.str === '') {
      flush()
      continue
    }
    if (item.str.trim() === '') {
      const size = Math.abs(item.transform?.[3] ?? 0) || item.height || 10
      if ((item.width ?? 0) > GAP_FONT_SIZES * size) flush()
      else if (cur) cur += ' '
      continue
    }
    cur += item.str
    if (item.hasEOL) cur += ' '
  }
  flush()
  return lines.map((l) => l.trim()).filter(Boolean)
}

type PdfjsModule = {
  getDocument(params: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(opts?: Record<string, unknown>): Promise<{ items: PdfTextItem[] }> }>; destroy(): Promise<void> }> }
}

let pdfjs: Promise<PdfjsModule> | null = null

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjs) {
    // The legacy build runs in Node without a DOM; kept out of the bundle (next.config.js).
    pdfjs = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfjsModule>
  }
  return pdfjs
}

/** Every page's lines. Refuses more than `maxPages` pages rather than reading a book. */
export async function pdfPages(bytes: Uint8Array, opts: { maxPages?: number } = {}): Promise<string[][]> {
  const lib = await loadPdfjs()
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise
  try {
    const max = opts.maxPages ?? 60
    if (doc.numPages > max) throw new Error(`the PDF has ${doc.numPages} pages; a CMF packet has at most ${max}`)
    const pages: string[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const tc = await page.getTextContent()
      pages.push(linesFromItems(tc.items))
    }
    return pages
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}
