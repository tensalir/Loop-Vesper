/**
 * Pure timeline editing operations.
 * All functions are immutable — they return new arrays/objects.
 */

import type {
  TimelineTrack,
  TimelineClip,
  TimelineTransition,
  TimelineCaption,
  TrackKind,
  CaptionStyle,
} from '@/types/timeline'

let _idCounter = 0
function genId(): string {
  _idCounter++
  return `local-${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`
}

// ── Track operations ──

export function createTrack(kind: TrackKind, label?: string, sortOrder = 0): TimelineTrack {
  return {
    id: genId(),
    sequenceId: '',
    kind,
    label: label || (kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Captions'),
    sortOrder,
    isMuted: false,
    clips: [],
  }
}

// ── Clip operations ──

export function insertClip(
  track: TimelineTrack,
  fileUrl: string,
  fileType: 'video' | 'image' | 'audio',
  sourceDurationMs: number,
  outputId?: string
): { track: TimelineTrack; clip: TimelineClip } {
  const lastClipEnd = track.clips.reduce((max, c) => Math.max(max, c.endMs), 0)
  const startMs = lastClipEnd
  const endMs = startMs + sourceDurationMs

  const clip: TimelineClip = {
    id: genId(),
    trackId: track.id,
    outputId: outputId || null,
    fileUrl,
    fileType,
    startMs,
    endMs,
    inPointMs: 0,
    outPointMs: sourceDurationMs,
    sourceDurationMs,
    sortOrder: track.clips.length,
  }

  return {
    track: { ...track, clips: [...track.clips, clip] },
    clip,
  }
}

export function splitClipAtPlayhead(
  track: TimelineTrack,
  clipId: string,
  playheadMs: number
): TimelineTrack {
  const clipIndex = track.clips.findIndex((c) => c.id === clipId)
  if (clipIndex === -1) return track

  const clip = track.clips[clipIndex]
  if (playheadMs <= clip.startMs || playheadMs >= clip.endMs) return track

  const relativeMs = playheadMs - clip.startMs
  const leftInPoint = clip.inPointMs
  const leftOutPoint = clip.inPointMs + relativeMs
  const rightInPoint = leftOutPoint
  const rightOutPoint = clip.outPointMs

  const leftClip: TimelineClip = {
    ...clip,
    endMs: playheadMs,
    outPointMs: leftOutPoint,
  }

  const rightClip: TimelineClip = {
    ...clip,
    id: genId(),
    startMs: playheadMs,
    inPointMs: rightInPoint,
    outPointMs: rightOutPoint,
    sortOrder: clip.sortOrder + 1,
  }

  const newClips = [...track.clips]
  newClips.splice(clipIndex, 1, leftClip, rightClip)
  return { ...track, clips: newClips }
}

export function removeClip(track: TimelineTrack, clipId: string): TimelineTrack {
  return { ...track, clips: track.clips.filter((c) => c.id !== clipId) }
}

export function moveClip(
  track: TimelineTrack,
  clipId: string,
  newStartMs: number
): TimelineTrack {
  const clipIndex = track.clips.findIndex((c) => c.id === clipId)
  if (clipIndex === -1) return track

  const clip = track.clips[clipIndex]
  const duration = clip.endMs - clip.startMs
  const snappedStart = snapToNearby(
    newStartMs,
    track.clips.filter((c) => c.id !== clipId),
    20
  )
  const updated: TimelineClip = {
    ...clip,
    startMs: Math.max(0, snappedStart),
    endMs: Math.max(0, snappedStart) + duration,
  }

  const newClips = [...track.clips]
  newClips[clipIndex] = updated
  return { ...track, clips: newClips }
}

// ── Transition operations ──

export function addCrossDissolve(
  transitions: TimelineTransition[],
  sequenceId: string,
  fromClipId: string,
  toClipId: string,
  durationMs = 500
): TimelineTransition[] {
  const exists = transitions.find(
    (t) => t.fromClipId === fromClipId && t.toClipId === toClipId
  )
  if (exists) return transitions

  const transition: TimelineTransition = {
    id: genId(),
    sequenceId,
    type: 'cross_dissolve',
    fromClipId,
    toClipId,
    durationMs,
  }

  return [...transitions, transition]
}

export function removeTransition(
  transitions: TimelineTransition[],
  transitionId: string
): TimelineTransition[] {
  return transitions.filter((t) => t.id !== transitionId)
}

// ── Caption operations ──

export function addCaption(
  track: TimelineTrack,
  text: string,
  startMs: number,
  endMs: number,
  style?: Partial<CaptionStyle>
): TimelineTrack {
  const caption: TimelineCaption = {
    id: genId(),
    trackId: track.id,
    text,
    startMs,
    endMs,
    style: {
      fontSize: 24,
      fontWeight: 600,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0.6)',
      position: 'bottom',
      alignment: 'center',
      ...style,
    },
  }

  return { ...track, captions: [...(track.captions ?? []), caption] }
}

export function removeCaption(track: TimelineTrack, captionId: string): TimelineTrack {
  return {
    ...track,
    captions: (track.captions ?? []).filter((c) => c.id !== captionId),
  }
}

// ── Snapping utilities ──

const SNAP_THRESHOLD_MS = 100

export function snapToGrid(ms: number, gridMs: number): number {
  return Math.round(ms / gridMs) * gridMs
}

export function snapToNearby(
  ms: number,
  clips: TimelineClip[],
  thresholdPx = 20,
  msPerPx = 10
): number {
  const threshold = thresholdPx * msPerPx
  let closest = ms
  let minDist = threshold

  for (const clip of clips) {
    const distToStart = Math.abs(ms - clip.startMs)
    const distToEnd = Math.abs(ms - clip.endMs)

    if (distToStart < minDist) {
      minDist = distToStart
      closest = clip.startMs
    }
    if (distToEnd < minDist) {
      minDist = distToEnd
      closest = clip.endMs
    }
  }

  return closest
}

// ── Duration calculation ──

export function computeSequenceDuration(tracks: TimelineTrack[]): number {
  let maxEnd = 0
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.endMs > maxEnd) maxEnd = clip.endMs
    }
    for (const cap of track.captions ?? []) {
      if (cap.endMs > maxEnd) maxEnd = cap.endMs
    }
  }
  return maxEnd
}

// ── Collision detection ──

export function hasOverlap(clips: TimelineClip[], excludeId?: string): boolean {
  const sorted = clips
    .filter((c) => c.id !== excludeId)
    .sort((a, b) => a.startMs - b.startMs)

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMs < sorted[i - 1].endMs) return true
  }
  return false
}

export function findInsertPosition(clips: TimelineClip[]): number {
  return clips.reduce((max, c) => Math.max(max, c.endMs), 0)
}

// ── Trim operations ──

export function trimClipLeft(
  track: TimelineTrack,
  clipId: string,
  newStartMs: number
): TimelineTrack {
  const idx = track.clips.findIndex((c) => c.id === clipId)
  if (idx === -1) return track
  const clip = track.clips[idx]
  const clamped = Math.max(0, Math.min(newStartMs, clip.endMs - 100))
  const delta = clamped - clip.startMs
  const updated: TimelineClip = {
    ...clip,
    startMs: clamped,
    inPointMs: Math.max(0, clip.inPointMs + delta),
  }
  const newClips = [...track.clips]
  newClips[idx] = updated
  return { ...track, clips: newClips }
}

export function trimClipRight(
  track: TimelineTrack,
  clipId: string,
  newEndMs: number
): TimelineTrack {
  const idx = track.clips.findIndex((c) => c.id === clipId)
  if (idx === -1) return track
  const clip = track.clips[idx]
  const clamped = Math.max(clip.startMs + 100, newEndMs)
  const newDuration = clamped - clip.startMs
  const updated: TimelineClip = {
    ...clip,
    endMs: clamped,
    outPointMs: Math.min(clip.sourceDurationMs, clip.inPointMs + newDuration),
  }
  const newClips = [...track.clips]
  newClips[idx] = updated
  return { ...track, clips: newClips }
}

// ── Targeted insertion ──

export function insertClipAt(
  track: TimelineTrack,
  fileUrl: string,
  fileType: 'video' | 'image' | 'audio',
  sourceDurationMs: number,
  startMs: number,
  outputId?: string
): { track: TimelineTrack; clip: TimelineClip } {
  const endMs = startMs + sourceDurationMs
  const clip: TimelineClip = {
    id: genId(),
    trackId: track.id,
    outputId: outputId || null,
    fileUrl,
    fileType,
    startMs,
    endMs,
    inPointMs: 0,
    outPointMs: sourceDurationMs,
    sourceDurationMs,
    sortOrder: track.clips.length,
  }
  return {
    track: { ...track, clips: [...track.clips, clip] },
    clip,
  }
}

export function insertTrackAbove(
  tracks: TimelineTrack[],
  referenceTrackId: string,
  kind: TrackKind,
  label?: string
): { tracks: TimelineTrack[]; newTrack: TimelineTrack } {
  const refIdx = tracks.findIndex((t) => t.id === referenceTrackId)
  const insertIdx = refIdx === -1 ? 0 : refIdx
  const newTrack = createTrack(kind, label, insertIdx)
  const reordered = [...tracks]
  reordered.splice(insertIdx, 0, newTrack)
  for (let i = 0; i < reordered.length; i++) {
    reordered[i] = { ...reordered[i], sortOrder: i }
  }
  return { tracks: reordered, newTrack }
}

// ── Transition duration update ──

export function updateTransitionDuration(
  transitions: TimelineTransition[],
  transitionId: string,
  newDurationMs: number
): TimelineTransition[] {
  return transitions.map((t) =>
    t.id === transitionId
      ? { ...t, durationMs: Math.max(100, Math.min(2000, newDurationMs)) }
      : t
  )
}
