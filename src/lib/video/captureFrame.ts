/**
 * Reusable video frame capture utility.
 *
 * Captures a single frame from a <video> element at the current playback
 * position and returns it as a Blob + object URL. Works from both the
 * timeline editor and the gallery / image-to-video overlay.
 */

export interface CapturedFrame {
  blob: Blob
  objectUrl: string
  width: number
  height: number
  timecodeMs: number
}

/**
 * Capture the current visible frame of a video element as a JPEG blob.
 * Returns null if the video has no dimensions (not loaded yet).
 */
export async function captureCurrentFrameAsync(
  video: HTMLVideoElement,
  quality = 0.92
): Promise<CapturedFrame | null> {
  const width = video.videoWidth || video.clientWidth
  const height = video.videoHeight || video.clientHeight

  if (width === 0 || height === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(video, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  })

  if (!blob) return null

  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    width,
    height,
    timecodeMs: Math.round(video.currentTime * 1000),
  }
}

/** Alias for direct-call convenience in gallery/overlay callsites */
export const captureFrame = captureCurrentFrameAsync

/**
 * Upload a captured frame as a snapshot via the outputs API.
 * Returns the created generation + output pair.
 */
export async function uploadSnapshot(
  videoOutputId: string,
  blob: Blob,
  timecodeMs: number,
  sessionId?: string
): Promise<{ generation: any; output: any }> {
  const file = new File([blob], `snapshot-${timecodeMs}ms.jpg`, { type: 'image/jpeg' })
  const formData = new FormData()
  formData.append('file', file)
  formData.append('timecodeMs', String(timecodeMs))
  if (sessionId) formData.append('sessionId', sessionId)

  const res = await fetch(`/api/outputs/${videoOutputId}/snapshots`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to capture snapshot')
  }

  return res.json()
}
