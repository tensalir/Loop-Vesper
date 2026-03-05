import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { ComposerMode, TimelineSequence } from '@/types/timeline'
import { beginModeSwitch, endModeSwitch, type ModeSwitchMark } from '@/lib/timeline/performance'
import { createTrack, insertClip, insertClipAt, insertTrackAbove, computeSequenceDuration } from '@/lib/timeline/operations'

interface TimelineStore {
  // Mode
  composerMode: ComposerMode
  modeSwitchMark: ModeSwitchMark | null

  // Sequence state
  sequence: TimelineSequence | null
  playheadMs: number
  zoom: number
  isPlaying: boolean
  selectedClipId: string | null
  selectedTrackId: string | null
  activeTool: 'select' | 'cut' | 'caption'
  isDirty: boolean

  // Snapshot prompt morph state
  snapshotPrompt: {
    snapshotUrl: string | null
    clipId: string | null
    trackId: string | null
    timecodeMs: number
    isAtClipEnd: boolean
    outputId: string | null
  }

  // Browse library
  isLibraryOpen: boolean

  // Render
  isExportPanelOpen: boolean

  // Actions
  setComposerMode: (mode: ComposerMode) => void
  finishModeSwitch: () => void
  setSequence: (seq: TimelineSequence | null) => void
  setPlayheadMs: (ms: number) => void
  setZoom: (zoom: number) => void
  setIsPlaying: (playing: boolean) => void
  setSelectedClipId: (id: string | null) => void
  setSelectedTrackId: (id: string | null) => void
  setActiveTool: (tool: 'select' | 'cut' | 'caption') => void
  markDirty: () => void
  markClean: () => void
  setSnapshotPrompt: (snap: TimelineStore['snapshotPrompt']) => void
  clearSnapshotPrompt: () => void
  setLibraryOpen: (open: boolean) => void
  setExportPanelOpen: (open: boolean) => void
  insertVideoClip: (videoUrl: string, outputId: string, durationMs: number) => boolean
  insertVideoClipTargeted: (
    videoUrl: string, outputId: string, durationMs: number,
    mode: 'sameTrackAfter' | 'newTrackAbove',
    referenceClipId: string, referenceTrackId: string,
    startMs?: number
  ) => boolean
  resetTimeline: () => void
}

export const useTimelineStore = create<TimelineStore>()(
  devtools(
    (set, get) => ({
      composerMode: 'generate',
      modeSwitchMark: null,
      sequence: null,
      playheadMs: 0,
      zoom: 1,
      isPlaying: false,
      selectedClipId: null,
      selectedTrackId: null,
      activeTool: 'select',
      isDirty: false,
      snapshotPrompt: {
        snapshotUrl: null, clipId: null, trackId: null,
        timecodeMs: 0, isAtClipEnd: false, outputId: null,
      },
      isLibraryOpen: false,
      isExportPanelOpen: false,

      setComposerMode: (mode) => {
        const current = get().composerMode
        if (current === mode) return
        const mark = beginModeSwitch(current, mode)
        set(
          { composerMode: mode, modeSwitchMark: mark, isPlaying: false },
          false,
          'setComposerMode'
        )
      },

      finishModeSwitch: () => {
        const mark = get().modeSwitchMark
        if (mark) {
          endModeSwitch(mark)
          set({ modeSwitchMark: null }, false, 'finishModeSwitch')
        }
      },

      setSequence: (seq) => set({ sequence: seq }, false, 'setSequence'),
      setPlayheadMs: (ms) => set({ playheadMs: Math.max(0, ms) }, false, 'setPlayheadMs'),
      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }, false, 'setZoom'),
      setIsPlaying: (playing) => set({ isPlaying: playing }, false, 'setIsPlaying'),
      setSelectedClipId: (id) => set({ selectedClipId: id }, false, 'setSelectedClipId'),
      setSelectedTrackId: (id) => set({ selectedTrackId: id }, false, 'setSelectedTrackId'),
      setActiveTool: (tool) => set({ activeTool: tool }, false, 'setActiveTool'),
      markDirty: () => set({ isDirty: true }, false, 'markDirty'),
      markClean: () => set({ isDirty: false }, false, 'markClean'),
      setSnapshotPrompt: (snap) => set({ snapshotPrompt: snap }, false, 'setSnapshotPrompt'),
      clearSnapshotPrompt: () => set({
        snapshotPrompt: { snapshotUrl: null, clipId: null, trackId: null, timecodeMs: 0, isAtClipEnd: false, outputId: null },
      }, false, 'clearSnapshotPrompt'),
      setLibraryOpen: (open) => set({ isLibraryOpen: open }, false, 'setLibraryOpen'),
      setExportPanelOpen: (open) => set({ isExportPanelOpen: open }, false, 'setExportPanelOpen'),
      insertVideoClip: (videoUrl, outputId, durationMs) => {
        let currentSequence = get().sequence

        if (!currentSequence) {
          currentSequence = {
            id: `local-seq-${Date.now()}`,
            projectId: '',
            sessionId: null,
            name: 'Sequence 1',
            durationMs: 0,
            fps: 30,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tracks: [],
          }
        }

        let tracks = [...currentSequence.tracks]
        let videoTrack = tracks.find((track) => track.kind === 'video')

        if (!videoTrack) {
          videoTrack = createTrack('video', 'Video', 0)
          videoTrack.sequenceId = currentSequence.id
          tracks = [videoTrack, ...tracks]
        }

        const { track: updatedTrack } = insertClip(
          videoTrack,
          videoUrl,
          'video',
          durationMs,
          outputId
        )
        tracks = tracks.map((track) => (track.id === updatedTrack.id ? updatedTrack : track))

        set(
          {
            sequence: {
              ...currentSequence,
              tracks,
              durationMs: computeSequenceDuration(tracks),
            },
            selectedTrackId: updatedTrack.id,
            isDirty: true,
          },
          false,
          'insertVideoClip'
        )
        return true
      },

      insertVideoClipTargeted: (videoUrl, outputId, durationMs, mode, referenceClipId, referenceTrackId, startMs) => {
        let currentSequence = get().sequence
        if (!currentSequence) return false

        let tracks = [...currentSequence.tracks]

        if (mode === 'sameTrackAfter') {
          const track = tracks.find((t) => t.id === referenceTrackId)
          if (!track) return false
          const refClip = track.clips.find((c) => c.id === referenceClipId)
          const insertAt = startMs ?? (refClip ? refClip.endMs : 0)
          const { track: updatedTrack } = insertClipAt(track, videoUrl, 'video', durationMs, insertAt, outputId)
          tracks = tracks.map((t) => (t.id === updatedTrack.id ? updatedTrack : t))
        } else {
          const { tracks: reordered, newTrack } = insertTrackAbove(tracks, referenceTrackId, 'video')
          const insertAt = startMs ?? 0
          const { track: updatedTrack } = insertClipAt(newTrack, videoUrl, 'video', durationMs, insertAt, outputId)
          tracks = reordered.map((t) => (t.id === updatedTrack.id ? updatedTrack : t))
          for (let i = 0; i < tracks.length; i++) {
            tracks[i] = { ...tracks[i], sequenceId: currentSequence.id }
          }
        }

        set(
          {
            sequence: { ...currentSequence, tracks, durationMs: computeSequenceDuration(tracks) },
            isDirty: true,
          },
          false,
          'insertVideoClipTargeted'
        )
        return true
      },

      resetTimeline: () =>
        set(
          {
            sequence: null,
            playheadMs: 0,
            zoom: 1,
            isPlaying: false,
            selectedClipId: null,
            selectedTrackId: null,
            activeTool: 'select',
            isDirty: false,
            isLibraryOpen: false,
            isExportPanelOpen: false,
          },
          false,
          'resetTimeline'
        ),
    }),
    { name: 'TimelineStore' }
  )
)
