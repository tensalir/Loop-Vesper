import type { StageConfig } from './world-config'
import { zoneSessionName } from './world-config'

interface SessionLike {
  name: string
  type: string
}

interface MissingSession {
  name: string
  type: 'image' | 'video'
}

function getMissing(
  stages: StageConfig[],
  existingSessions: SessionLike[]
): MissingSession[] {
  const existingNames = new Set(existingSessions.map((s) => s.name))
  const missing: MissingSession[] = []

  for (const stage of stages) {
    for (const type of ['image', 'video'] as const) {
      const name = zoneSessionName(stage.sessionPrefix, type)
      if (!existingNames.has(name)) {
        missing.push({ name, type })
      }
    }
  }

  return missing
}

async function createMissing(
  projectId: string,
  sessions: MissingSession[]
): Promise<void> {
  await Promise.all(
    sessions.map((s) =>
      fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name: s.name, type: s.type }),
      })
    )
  )
}

export const bootstrapZoneSessions = { getMissing, createMissing }
