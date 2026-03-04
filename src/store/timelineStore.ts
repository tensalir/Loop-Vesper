import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { ComposerMode, TimelineSequence } from '@/types/timeline'
import { beginModeSwitch, endModeSwitch, type ModeSwitchMark } from '@/lib/timeline/performance'

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
  setLibraryOpen: (open: boolean) => void
  setExportPanelOpen: (open: boolean) => void
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
      setLibraryOpen: (open) => set({ isLibraryOpen: open }, false, 'setLibraryOpen'),
      setExportPanelOpen: (open) => set({ isExportPanelOpen: open }, false, 'setExportPanelOpen'),

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
