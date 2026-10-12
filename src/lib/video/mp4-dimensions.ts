/**
 * The real width and height of an MP4, read from its header.
 *
 * Every video adapter used to record a nominal 1280x720 (720x1280 portrait) whatever the
 * provider rendered. Measured on 2026-10-12, Kling 2.6's start-and-end-frame renders were
 * 1072x1928 and a 1:1 one 1440x1440, all recorded as 1280x720, so a 1080p render read as 720p
 * in the gallery and in Claude's answers.
 *
 * Only the header is read: the top-level boxes are walked with small range requests until
 * `moov` is found (at the start of a "fast start" file, after `mdat` otherwise), then the first
 * track header (`tkhd`) with a non-zero size gives the picture's size. A host that ignores the
 * Range header is read only as far as the first chunk. Any failure answers null, and the caller
 * keeps its nominal size.
 */

export interface VideoDimensions {
  width: number
  height: number
}

/** The first read: enough for `ftyp` plus a fast-start `moov` of a short clip. */
const HEAD_BYTES = 512 * 1024
/** A `moov` larger than this is not a short generated clip; stop rather than download it. */
const MAX_MOOV_BYTES = 8 * 1024 * 1024
const MAX_TOP_LEVEL_BOXES = 32

type RangeReader = (start: number, length: number) => Promise<Uint8Array | null>

function u32(buf: Uint8Array, at: number): number {
  return ((buf[at] << 24) | (buf[at + 1] << 16) | (buf[at + 2] << 8) | buf[at + 3]) >>> 0
}

function type4(buf: Uint8Array, at: number): string {
  return String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3])
}

/** A box header at `at`: its type, total size and header length, or null when cut off. */
function boxAt(buf: Uint8Array, at: number, end = buf.length) {
  if (at + 8 > end) return null
  let size = u32(buf, at)
  const type = type4(buf, at + 4)
  let header = 8
  if (size === 1) {
    if (at + 16 > end) return null
    const high = u32(buf, at + 8)
    const low = u32(buf, at + 12)
    size = high * 2 ** 32 + low
    header = 16
  } else if (size === 0) {
    size = end - at
  }
  if (size < header) return null
  return { type, size, header }
}

/** Width and height from a `tkhd` box's payload (16.16 fixed point), or null for a zero size. */
function readTkhd(buf: Uint8Array, payload: number, end: number): VideoDimensions | null {
  const version = buf[payload]
  const at = payload + (version === 1 ? 88 : 76)
  if (at + 8 > end) return null
  const width = Math.round(u32(buf, at) / 65536)
  const height = Math.round(u32(buf, at + 4) / 65536)
  return width > 0 && height > 0 ? { width, height } : null
}

/** The first track header with a picture size inside a whole `moov` box. */
export function dimensionsFromMoov(moov: Uint8Array): VideoDimensions | null {
  const top = boxAt(moov, 0)
  if (!top || top.type !== 'moov') return null
  const end = Math.min(moov.length, top.size)
  let at = top.header
  while (at < end) {
    const trak = boxAt(moov, at, end)
    if (!trak) return null
    if (trak.type === 'trak') {
      const trakEnd = Math.min(end, at + trak.size)
      let inner = at + trak.header
      while (inner < trakEnd) {
        const child = boxAt(moov, inner, trakEnd)
        if (!child) break
        if (child.type === 'tkhd') {
          const found = readTkhd(moov, inner + child.header, Math.min(trakEnd, inner + child.size))
          if (found) return found
          break
        }
        inner += child.size
      }
    }
    at += trak.size
  }
  return null
}

/** Walk the top-level boxes from the reader until `moov`, and read its track headers. */
export async function readMp4Dimensions(read: RangeReader): Promise<VideoDimensions | null> {
  const head = await read(0, HEAD_BYTES)
  if (!head || head.length < 8) return null

  let at = 0
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES; i++) {
    // The box header, from the first chunk when it is there, otherwise read on its own.
    const header = at + 16 <= head.length ? head.subarray(at, at + 16) : await read(at, 16)
    if (!header || header.length < 8) return null
    const box = boxAt(header, 0, header.length)
    if (!box) return null

    if (box.type === 'moov') {
      if (box.size > MAX_MOOV_BYTES) return null
      const moov = at + box.size <= head.length ? head.subarray(at, at + box.size) : await read(at, box.size)
      return moov ? dimensionsFromMoov(moov) : null
    }
    at += box.size
  }
  return null
}

/** A range reader over HTTP. A host that answers 200 to a Range request is read only once. */
export function httpRangeReader(url: string, fetchImpl: typeof fetch = fetch): RangeReader {
  let rangesIgnored = false
  return async (start, length) => {
    if (rangesIgnored && start > 0) return null
    const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } })
    if (!response.ok || !response.body) return null
    if (response.status !== 206) rangesIgnored = true
    // Never read more than asked for, even from a host that sends the whole file.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (received < length) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      received += value.length
    }
    await reader.cancel().catch(() => undefined)
    const out = new Uint8Array(Math.min(received, length))
    let offset = 0
    for (const chunk of chunks) {
      const take = Math.min(chunk.length, out.length - offset)
      out.set(chunk.subarray(0, take), offset)
      offset += take
      if (offset >= out.length) break
    }
    return out
  }
}

/** The real size of the video at `url`, or null when it cannot be read in time. */
export async function probeVideoDimensions(
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<VideoDimensions | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const timeoutMs = options.timeoutMs ?? 15_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    return await Promise.race([readMp4Dimensions(httpRangeReader(url, options.fetchImpl)), timeout])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The probed size when there is one, else the adapter's nominal size. */
export async function videoDimensionsOr(
  url: string,
  nominal: VideoDimensions,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<VideoDimensions> {
  return (await probeVideoDimensions(url, options)) ?? nominal
}
