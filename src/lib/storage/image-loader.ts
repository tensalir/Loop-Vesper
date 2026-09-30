import type { ImageLoaderProps } from 'next/image'
import { parseStorageRef, storageRouteUrl } from './refs'

/**
 * The `loader` for a `next/image` that may show a stored file. A file in one of the private
 * buckets is resized by Vesper's own `/api/storage/...?w=` (which checks the sign-in); Vercel's
 * optimizer is kept for everything else, with the address the default loader would have built.
 */
export function storageImageLoader({ src, width, quality }: ImageLoaderProps): string {
  const q = quality || 75
  const ref = parseStorageRef(src)
  if (ref) return storageRouteUrl(ref, { width, quality: q })
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${q}`
}
