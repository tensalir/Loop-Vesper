import type { BannerSlot } from './world-config'
import { getAllBannerSlots, STAGES, stageIdFromSessionName } from './world-config'

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
  sessionId?: string
  sessionName: string
  brandWorldStageId?: string
}

export interface PlacedBanner {
  slot: BannerSlot & { stageId: string }
  output: BrandWorldOutput
}

export interface PlacedRobot {
  output: BrandWorldOutput
  stageId: string
  position: [number, number, number]
  rotation: number
}

function resolveStageId(output: BrandWorldOutput): string | null {
  const fromSession = stageIdFromSessionName(output.sessionName)
  if (fromSession) return fromSession
  if (output.brandWorldStageId) return output.brandWorldStageId
  return null
}

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

const MAX_ROBOTS_PER_STAGE = 8

export function assignOutputsToRobots(outputs: BrandWorldOutput[]): PlacedRobot[] {
  const sorted = [...outputs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const stageQueues: Record<string, BrandWorldOutput[]> = {}
  for (const stage of STAGES) {
    stageQueues[stage.id] = []
  }

  for (const output of sorted) {
    const sid = resolveStageId(output)
    if (sid && stageQueues[sid]) {
      stageQueues[sid].push(output)
    }
  }

  const unassigned = sorted.filter((o) => {
    const sid = resolveStageId(o)
    return !sid || !stageQueues[sid]
  })
  let stageIdx = 0
  for (const output of unassigned) {
    const stageId = STAGES[stageIdx % STAGES.length].id
    stageQueues[stageId].push(output)
    stageIdx++
  }

  const robots: PlacedRobot[] = []
  for (const stage of STAGES) {
    const queue = stageQueues[stage.id].slice(0, MAX_ROBOTS_PER_STAGE)
    const cx = stage.position[0]
    const cz = stage.position[2]
    const radius = 8 * stage.scale

    for (let i = 0; i < queue.length; i++) {
      const angle = ((i / Math.max(queue.length, 1)) * Math.PI * 1.2) - Math.PI * 0.6
      const px = cx + Math.sin(angle) * radius
      const pz = cz + Math.cos(angle) * radius
      const faceAngle = Math.atan2(cx - px, cz - pz)

      robots.push({
        output: queue[i],
        stageId: stage.id,
        position: [px, 0, pz],
        rotation: faceAngle,
      })
    }
  }

  return robots
}
