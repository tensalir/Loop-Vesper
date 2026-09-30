'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toViewUrl } from '@/lib/storage/refs'

/**
 * Rectangle (in viewport coordinates) of the element the download was
 * initiated from. The flying-clone animation interpolates from this rect
 * to the registered target (top-right history button).
 */
export interface FlightSourceRect {
  top: number
  left: number
  width: number
  height: number
}

interface FlightArgs {
  imageUrl: string
  fileType: 'image' | 'video' | string
  sourceRect: FlightSourceRect
}

interface DownloadHistoryContextValue {
  /** Set by the top-right history button when it mounts. */
  registerTarget: (node: HTMLElement | null) => void
  /** Fire-and-forget: kick off the fly-to-corner animation. */
  triggerDownloadFlight: (args: FlightArgs) => void
  /** True for ~600ms after a flight lands; the button reads this to pulse. */
  pulseActive: boolean
}

const DownloadHistoryContext = createContext<DownloadHistoryContextValue | null>(null)

export function useDownloadFlight() {
  const ctx = useContext(DownloadHistoryContext)
  // Falling back to a no-op keeps callers from crashing when the provider
  // isn't mounted (e.g. in unit tests or other surfaces). Returns a stable
  // identity so dependency arrays stay calm.
  return ctx ?? FALLBACK_CTX
}

const FALLBACK_CTX: DownloadHistoryContextValue = {
  registerTarget: () => {},
  triggerDownloadFlight: () => {},
  pulseActive: false,
}

interface ActiveFlight {
  id: number
  imageUrl: string
  fileType: string
  from: FlightSourceRect
  to: { top: number; left: number; width: number; height: number }
  state: 'start' | 'land'
}

const FLIGHT_DURATION_MS = 650
const PULSE_DURATION_MS = 600

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Mount once at the project shell level. Provides:
 *   - a target registration slot for the top-right history button
 *   - `triggerDownloadFlight()` for the gallery / lightbox to call when the
 *     user saves a file
 *   - a portal overlay that paints the flying-clone animation
 *
 * On flight completion the provider invalidates the `['downloads']` query
 * so the modal shows the new item immediately the next time it's opened.
 */
export function DownloadHistoryProvider({ children }: { children: ReactNode }) {
  const targetRef = useRef<HTMLElement | null>(null)
  const queryClient = useQueryClient()
  const [flights, setFlights] = useState<ActiveFlight[]>([])
  const [pulseActive, setPulseActive] = useState(false)
  const nextIdRef = useRef(1)
  const [mounted, setMounted] = useState(false)

  // Portals need to wait until the DOM exists.
  useEffect(() => {
    setMounted(true)
  }, [])

  const registerTarget = useCallback((node: HTMLElement | null) => {
    targetRef.current = node
  }, [])

  const triggerDownloadFlight = useCallback(
    ({ imageUrl, fileType, sourceRect }: FlightArgs) => {
      // Invalidate so the history reflects the new download regardless of
      // whether the animation actually plays.
      queryClient.invalidateQueries({ queryKey: ['downloads'] })

      const targetEl = targetRef.current
      if (!targetEl || prefersReducedMotion()) {
        // No target mounted yet, or the user opted out of motion. Just
        // bump the badge.
        setPulseActive(true)
        window.setTimeout(() => setPulseActive(false), PULSE_DURATION_MS)
        return
      }

      const toRect = targetEl.getBoundingClientRect()
      const id = nextIdRef.current++
      const flight: ActiveFlight = {
        id,
        imageUrl,
        fileType,
        from: sourceRect,
        to: {
          top: toRect.top,
          left: toRect.left,
          width: toRect.width,
          height: toRect.height,
        },
        state: 'start',
      }

      setFlights((prev) => [...prev, flight])

      // Kick to 'land' on the next frame so CSS transitions actually run.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setFlights((prev) =>
            prev.map((f) => (f.id === id ? { ...f, state: 'land' } : f)),
          )
        })
      })

      // Clean up after the animation completes, then pulse the button.
      window.setTimeout(() => {
        setFlights((prev) => prev.filter((f) => f.id !== id))
        setPulseActive(true)
        window.setTimeout(() => setPulseActive(false), PULSE_DURATION_MS)
      }, FLIGHT_DURATION_MS)
    },
    [queryClient],
  )

  const value = useMemo<DownloadHistoryContextValue>(
    () => ({ registerTarget, triggerDownloadFlight, pulseActive }),
    [registerTarget, triggerDownloadFlight, pulseActive],
  )

  return (
    <DownloadHistoryContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
          >
            {flights.map((flight) => {
              const isLanding = flight.state === 'land'
              const rect = isLanding ? flight.to : flight.from
              const opacity = isLanding ? 0 : 1
              const borderRadius = isLanding ? 999 : 12
              return (
                <div
                  key={flight.id}
                  style={{
                    position: 'absolute',
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                    transition: `top ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), left ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), width ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), height ${FLIGHT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FLIGHT_DURATION_MS}ms ease-out, border-radius ${FLIGHT_DURATION_MS}ms ease-out`,
                    borderRadius,
                    opacity,
                    overflow: 'hidden',
                    boxShadow:
                      '0 12px 40px -8px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08) inset',
                    willChange: 'top, left, width, height, opacity',
                  }}
                >
                  {flight.fileType === 'video' ? (
                    <video
                      src={toViewUrl(flight.imageUrl)}
                      muted
                      playsInline
                      autoPlay={false}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={toViewUrl(flight.imageUrl)}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </DownloadHistoryContext.Provider>
  )
}
