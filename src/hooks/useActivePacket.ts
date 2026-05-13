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

/** Element id the gallery section sets so the pulse effect can find it. */
const GALLERY_NODE_ID = 'cmf-gallery'

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
      const node = document.getElementById(GALLERY_NODE_ID)
      if (!node) return
      // Re-trigger by removing the class first and forcing a reflow.
      // Some browsers cache animation state and re-applying the same
      // class without a reset doesn't replay the keyframes.
      node.classList.remove('cmf-focus-pulse')
      void node.offsetWidth
      node.classList.add('cmf-focus-pulse')
      timeoutId = window.setTimeout(() => {
        node.classList.remove('cmf-focus-pulse')
      }, PULSE_DURATION_MS)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [activePacketId])

  return { activePacketId, setActivePacketId }
}
