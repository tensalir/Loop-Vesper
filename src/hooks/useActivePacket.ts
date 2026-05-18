'use client'

/**
 * Owns the "which CMF packet is the workspace looking at right now?"
 * concern, including:
 *
 *   - The mutable `activePacketId` state.
 *   - URL synchronisation (`?packet=<id>` mirrored via `router.replace`
 *     so refresh + share-a-link + back/forward all keep the designer
 *     on the same packet).
 *   - URL-driven reconciliation (when `initialPacketId` changes — back
 *     button, deep link paste — the hook adopts it without writing
 *     back to the URL and looping).
 *   - Gallery-pulse choreography: whenever the active packet changes
 *     to a non-null id post-mount, we re-apply the `cmf-focus-pulse`
 *     keyframes to `#cmf-gallery` so the workspace visibly transitions
 *     instead of silently swapping content.
 *
 * Pulled out of `CmfPacketWorkspace.tsx` so the workspace component
 * stops accumulating orchestration concerns and so this behaviour can
 * be reused (or unit-tested) independently if a second surface ever
 * needs to drive the same URL+pulse contract.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Element ids that should pulse when the active packet changes.
 * Order is not significant; both nodes receive the same animation
 * on the same frame so the identity strip and the gallery feel
 * linked. The identity strip pulse is the answer to "where did my
 * import land?" — Damien's Gemini-confirmed failure mode was
 * closing the import dialog without ever spotting the success
 * surface, so the workspace strip becomes the success surface.
 */
const PULSE_NODE_IDS = ['cmf-identity-strip', 'cmf-gallery'] as const

/** Duration the `cmf-focus-pulse` keyframes run for. Mirrors the CSS. */
const PULSE_DURATION_MS = 2400

export interface UseActivePacketResult {
  /** The currently-selected packet id, or `null` for the empty state. */
  activePacketId: string | null
  /** Mutate the selection. Mirrors to the URL via `router.replace`
   *  (back button stays useful — it goes to the previous page, not
   *  the previous packet). Pass `null` to clear. */
  setActivePacketId: (next: string | null) => void
}

export function useActivePacket(
  initialPacketId: string | null
): UseActivePacketResult {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activePacketId, setActivePacketIdState] = useState<string | null>(
    initialPacketId
  )

  const setActivePacketId = useCallback(
    (next: string | null) => {
      setActivePacketIdState(next)
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next) params.set('packet', next)
      else params.delete('packet')
      const query = params.toString()
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  // Sync from URL changes that originate outside this hook: back/forward
  // navigation, pasted deep link. Compare against current state so we
  // don't ping-pong with `setActivePacketId` writing the URL itself.
  useEffect(() => {
    if (initialPacketId !== activePacketId) {
      setActivePacketIdState(initialPacketId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPacketId])

  // Gallery pulse on packet switch. Skip the initial mount so a refresh
  // that lands on a packet doesn't pulse for no reason; every later
  // change (manual switch, smart-merge auto-jump, products picker)
  // re-applies the keyframes to `#cmf-gallery`.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    if (!activePacketId) return
    // requestAnimationFrame defers the class-toggle until after React
    // has painted the new gallery contents — otherwise the pulse
    // animates the OLD DOM node and is invisible. We capture the
    // outer cleanup ref so unmounts mid-animation don't leak the
    // setTimeout.
    let timeoutId: number | undefined
    const raf = requestAnimationFrame(() => {
      // Pulse every registered node in lockstep (currently the
      // identity strip + the gallery). Each node needs its own
      // class reset + reflow so the keyframes replay even when
      // the class is already on the element from a previous pulse.
      const nodes = PULSE_NODE_IDS
        .map((id) => document.getElementById(id))
        .filter((n): n is HTMLElement => n !== null)
      if (nodes.length === 0) return
      for (const node of nodes) {
        node.classList.remove('cmf-focus-pulse')
        void node.offsetWidth
        node.classList.add('cmf-focus-pulse')
      }
      timeoutId = window.setTimeout(() => {
        for (const node of nodes) {
          node.classList.remove('cmf-focus-pulse')
        }
      }, PULSE_DURATION_MS)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [activePacketId])

  return { activePacketId, setActivePacketId }
}
