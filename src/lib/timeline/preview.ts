import type { TimelineTrack, TimelineClip } from '@/types/timeline'

/**
 * Micro-gap tolerance: when the playhead falls between two clips on the same
 * track within this many ms, we bridge forward to the next clip so the
 * preview doesn't flash black.
 */
const GAP_TOLERANCE_MS = 50

interface AnnotatedClip extends TimelineClip {
  /** The sortOrder of the track this clip belongs to. */
  trackSortOrder: number
}

/**
 * Resolve which clip the preview <video> should display at a given playhead
 * position.
 *
 * Priority rules:
 *   1. If any clip from a higher-sortOrder (visually top) track covers the
 *      playhead, it wins over lower tracks — this is critical for snapshot
 *      generations inserted on new tracks above the source clip.
 *   2. Within the same track level, the first clip whose range contains the
 *      playhead is chosen (same as before).
 *   3. Micro-gap bridging only applies *within* a track — we never bridge
 *      across tracks.
 *   4. Before the first global clip → show the first clip.
 *   5. At/after the last global clip → show the last clip.
 */
export function resolvePreviewClip(
  tracks: TimelineTrack[],
  playheadMs: number,
): TimelineClip | null {
  const videoTracks = tracks.filter((t) => t.kind === 'video' && t.clips.length > 0)
  if (videoTracks.length === 0) return null

  // Annotate every clip with its parent track's sortOrder so we can compare
  // across tracks later.
  const allAnnotated: AnnotatedClip[] = videoTracks.flatMap((track) =>
    track.clips.map((clip) => ({ ...clip, trackSortOrder: track.sortOrder })),
  )

  if (allAnnotated.length === 0) return null

  // ── 1. Find the best active clip respecting track stacking ──
  // Collect all clips that contain the playhead, then pick the one from the
  // highest track (largest sortOrder = visually on top).
  const covering = allAnnotated.filter(
    (c) => playheadMs >= c.startMs && playheadMs < c.endMs,
  )

  if (covering.length > 0) {
    covering.sort((a, b) => b.trackSortOrder - a.trackSortOrder)
    return stripAnnotation(covering[0])
  }

  // ── 2. Global first / last fallbacks ──
  const sorted = [...allAnnotated].sort((a, b) => a.startMs - b.startMs)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  if (playheadMs < first.startMs) return stripAnnotation(first)
  if (playheadMs >= last.endMs) return stripAnnotation(last)

  // ── 3. Micro-gap bridging (per-track) ──
  // For each video track, check if the playhead is in a small gap between
  // two adjacent clips — if so, bridge forward to the next clip. Pick the
  // bridged result from the highest track.
  let bridged: AnnotatedClip | null = null

  for (const track of videoTracks) {
    const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs)
    for (let i = 0; i < clips.length - 1; i++) {
      const cur = clips[i]
      const nxt = clips[i + 1]
      if (playheadMs >= cur.endMs && playheadMs < nxt.startMs) {
        if (nxt.startMs - cur.endMs <= GAP_TOLERANCE_MS) {
          const candidate: AnnotatedClip = { ...nxt, trackSortOrder: track.sortOrder }
          if (!bridged || candidate.trackSortOrder > bridged.trackSortOrder) {
            bridged = candidate
          }
        }
        break
      }
    }
  }

  return bridged ? stripAnnotation(bridged) : null
}

function stripAnnotation(clip: AnnotatedClip): TimelineClip {
  const { trackSortOrder: _, ...rest } = clip
  return rest
}
