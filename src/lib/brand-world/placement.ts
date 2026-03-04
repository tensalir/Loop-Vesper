import type { BannerSlot } from './world-config'
import { getAllBannerSlots } from './world-config'

export interface BrandWorldOutput {
  id: string
  fileUrl: string
  fileType: 'image' | 'video'
  width: number | null
  height: number | null
  duration: number | null
  createdAt: string
  prompt: string
  generationId: string
  sessionName: string
}

export interface PlacedBanner {
  slot: BannerSlot & { stageId: string }
  output: BrandWorldOutput
}

/**
 * Deterministic slot placement: assigns the newest outputs to available
 * banner slots in order. No DB storage needed for v1.
 */
export function assignOutputsToSlots(outputs: BrandWorldOutput[]): PlacedBanner[] {
  const slots = getAllBannerSlots()
  const sorted = [...outputs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const placed: PlacedBanner[] = []
  const limit = Math.min(sorted.length, slots.length)

  for (let i = 0; i < limit; i++) {
    placed.push({ slot: slots[i], output: sorted[i] })
  }

  return placed
}
