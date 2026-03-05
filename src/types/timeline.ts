/**
 * Timeline editor domain types.
 * Units: milliseconds for time, 30 FPS fixed, max 120 000 ms.
 */

export const TIMELINE_FPS = 30
export const TIMELINE_MAX_DURATION_MS = 120_000

export type ComposerMode = 'generate' | 'timeline' | 'timelinePrompt'

export type TrackKind = 'video' | 'caption' | 'audio'

export type TransitionType = 'cross_dissolve'

export interface TimelineSequence {
  id: string
  projectId: string
  sessionId: string | null
  name: string
  durationMs: number
  fps: number
  createdAt: string
  updatedAt: string
  tracks: TimelineTrack[]
  transitions?: TimelineTransition[]
}

export interface TimelineTrack {
  id: string
  sequenceId: string
  kind: TrackKind
  label: string
  sortOrder: number
  isMuted: boolean
  clips: TimelineClip[]
  captions?: TimelineCaption[]
}

export interface TimelineClip {
  id: string
  trackId: string
  outputId: string | null
  fileUrl: string
  fileType: 'video' | 'image' | 'audio'
  startMs: number
  endMs: number
  inPointMs: number
  outPointMs: number
  sourceDurationMs: number
  sortOrder: number
}

export interface TimelineTransition {
  id: string
  sequenceId: string
  type: TransitionType
  fromClipId: string
  toClipId: string
  durationMs: number
}

export interface TimelineCaption {
  id: string
  trackId: string
  text: string
  startMs: number
  endMs: number
  style: CaptionStyle
}

export interface CaptionStyle {
  fontSize: number
  fontWeight: number
  color: string
  backgroundColor: string
  position: 'bottom' | 'top' | 'center'
  alignment: 'left' | 'center' | 'right'
}

export interface TimelineRenderJob {
  id: string
  sequenceId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  outputUrl: string | null
  outputId: string | null
  error: string | null
  resolution: number
  createdAt: string
  completedAt: string | null
}

export interface TimelineState {
  sequence: TimelineSequence | null
  playheadMs: number
  zoom: number
  isPlaying: boolean
  selectedClipId: string | null
  selectedTrackId: string | null
  activeTool: 'select' | 'cut' | 'caption'
  isDirty: boolean
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 24,
  fontWeight: 600,
  color: '#FFFFFF',
  backgroundColor: 'rgba(0,0,0,0.6)',
  position: 'bottom',
  alignment: 'center',
}

export function createEmptySequence(projectId: string, sessionId: string | null): Omit<TimelineSequence, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    projectId,
    sessionId,
    name: 'Untitled Sequence',
    durationMs: 0,
    fps: TIMELINE_FPS,
    tracks: [],
  }
}

export function msToTimecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const frames = Math.floor((ms % 1000) / (1000 / TIMELINE_FPS))
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

export function timecodeToMs(timecode: string): number {
  const [min, sec, frame] = timecode.split(':').map(Number)
  return (min * 60 + sec) * 1000 + frame * (1000 / TIMELINE_FPS)
}
