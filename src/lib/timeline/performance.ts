/**
 * Timeline mode-switch performance instrumentation.
 *
 * Budgets (enforced via console warnings in dev):
 *   - mode-switch visual completion: <= 350 ms
 *   - no long-task spikes (> 50 ms main-thread blocks) during switch
 *   - memory drift after 10 toggle cycles: bounded within 20 MB
 */

const BUDGET_SWITCH_MS = 350
const DEV = process.env.NODE_ENV === 'development'

let switchCounter = 0

export interface ModeSwitchMark {
  id: number
  from: string
  to: string
  startMs: number
}

export function beginModeSwitch(
  from: string,
  to: string
): ModeSwitchMark {
  switchCounter++
  const mark: ModeSwitchMark = {
    id: switchCounter,
    from,
    to,
    startMs: performance.now(),
  }

  if (DEV) {
    performance.mark(`mode-switch-${mark.id}-start`)
  }

  return mark
}

export function endModeSwitch(mark: ModeSwitchMark): number {
  const elapsed = performance.now() - mark.startMs

  if (DEV) {
    performance.mark(`mode-switch-${mark.id}-end`)
    try {
      performance.measure(
        `mode-switch-${mark.id}`,
        `mode-switch-${mark.id}-start`,
        `mode-switch-${mark.id}-end`
      )
    } catch {
      // measure can throw if marks were cleared
    }

    if (elapsed > BUDGET_SWITCH_MS) {
      console.warn(
        `[Timeline Perf] Mode switch #${mark.id} (${mark.from}→${mark.to}) took ${elapsed.toFixed(1)}ms — exceeds ${BUDGET_SWITCH_MS}ms budget`
      )
    } else {
      console.debug(
        `[Timeline Perf] Mode switch #${mark.id} (${mark.from}→${mark.to}): ${elapsed.toFixed(1)}ms`
      )
    }
  }

  return elapsed
}

export function getSwitchCount(): number {
  return switchCounter
}

/**
 * Snapshot current JS heap usage (Chrome only).
 * Returns null on browsers without memory API.
 */
export function getMemorySnapshot(): { usedMB: number; totalMB: number } | null {
  const mem = (performance as any).memory
  if (!mem) return null
  return {
    usedMB: Math.round(mem.usedJSHeapSize / (1024 * 1024)),
    totalMB: Math.round(mem.totalJSHeapSize / (1024 * 1024)),
  }
}
