import { prisma } from '@/lib/prisma'

/**
 * Append a debug log entry to a generation's parameters.debugLogs array.
 * Keeps only the last 100 entries. Silently swallows errors.
 * 
 * Usage:
 * ```ts
 * await appendDebugLog(generationId, 'process:triggered')
 * await appendDebugLog(generationId, 'process:failed', { error: 'timeout' })
 * ```
 */
export async function appendDebugLog(
  generationId: string,
  step: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const gen = await prisma.generation.findUnique({
      where: { id: generationId },
      select: { parameters: true },
    })
    const params = (gen?.parameters as Record<string, unknown>) || {}
    const logs = Array.isArray(params.debugLogs) ? params.debugLogs : []
    logs.push({ at: new Date().toISOString(), step, ...extra })
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        parameters: {
          ...params,
          debugLogs: logs.slice(-100),
          lastStep: step,
        },
      },
    })
  } catch {
    // Silently swallow - debug logging should never break generation flow
  }
}
