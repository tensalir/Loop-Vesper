'use client'

import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import {
  Scissors, Type, MousePointer2, Play, Pause, SkipBack,
  FolderOpen, Download, Plus, ZoomIn, ZoomOut,
  Volume2, VolumeX, GripVertical, X, Save, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { msToTimecode, type TimelineTrack } from '@/types/timeline'
import {
  createTrack, splitClipAtPlayhead, removeClip,
  addCrossDissolve, addCaption,
  computeSequenceDuration,
} from '@/lib/timeline/operations'
import { useSaveSequence } from '@/hooks/useTimeline'

interface TimelineEditorProps {
  projectId: string
  onOpenLibrary: () => void
  className?: string
}

export function TimelineEditor({ projectId, onOpenLibrary, className }: TimelineEditorProps) {
  const {
    sequence, playheadMs, zoom, isPlaying, activeTool,
    selectedClipId, selectedTrackId, isExportPanelOpen,
    setSequence, setPlayheadMs, setZoom, setIsPlaying,
    setActiveTool, setSelectedClipId, setSelectedTrackId,
    setExportPanelOpen, markDirty, isDirty, finishModeSwitch,
  } = useTimelineStore()

  const saveMutation = useSaveSequence(projectId, sequence?.id || '')
  const tracksAreaRef = useRef<HTMLDivElement>(null)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    finishModeSwitch()
    return () => {
      setMounted(false)
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [finishModeSwitch])

  // Playback simulation
  useEffect(() => {
    if (isPlaying && sequence) {
      playIntervalRef.current = setInterval(() => {
        const store = useTimelineStore.getState()
        const next = store.playheadMs + 33 // ~30fps step
        if (next >= (store.sequence?.durationMs ?? 0)) {
          store.setPlayheadMs(0)
          store.setIsPlaying(false)
        } else {
          store.setPlayheadMs(next)
        }
      }, 33)
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [isPlaying, sequence])

  const durationMs = sequence?.durationMs ?? 0
  const viewDurationMs = Math.max(durationMs, 10_000) / zoom
  const previewClip = useMemo(() => {
    const videoClips = (sequence?.tracks ?? [])
      .filter((track) => track.kind === 'video')
      .flatMap((track) => track.clips)
      .sort((a, b) => a.startMs - b.startMs)

    if (videoClips.length === 0) return null
    return (
      videoClips.find((clip) => playheadMs >= clip.startMs && playheadMs < clip.endMs) ??
      videoClips[0]
    )
  }, [sequence, playheadMs])

  useEffect(() => {
    const previewElement = previewVideoRef.current
    if (!previewElement) return

    if (!previewClip) {
      previewElement.pause()
      return
    }

    const localMs = Math.max(
      previewClip.inPointMs,
      Math.min(
        previewClip.outPointMs,
        previewClip.inPointMs + Math.max(0, playheadMs - previewClip.startMs)
      )
    )
    const nextTime = localMs / 1000

    if (Math.abs(previewElement.currentTime - nextTime) > 0.12) {
      previewElement.currentTime = nextTime
    }

    if (isPlaying) {
      void previewElement.play().catch(() => {
        // Ignore browser autoplay restrictions for muted preview.
      })
    } else {
      previewElement.pause()
    }
  }, [previewClip, playheadMs, isPlaying])

  const handleAddTrack = useCallback((kind: 'video' | 'caption' | 'audio') => {
    if (!sequence) return
    const sortOrder = sequence.tracks.length
    const track = createTrack(kind, undefined, sortOrder)
    track.sequenceId = sequence.id
    setSequence({
      ...sequence,
      tracks: [...sequence.tracks, track],
    })
    markDirty()
  }, [sequence, setSequence, markDirty])

  const handleSplitAtPlayhead = useCallback(() => {
    if (!sequence || !selectedClipId) return
    const newTracks = sequence.tracks.map((track) => {
      if (track.clips.some((c) => c.id === selectedClipId)) {
        return splitClipAtPlayhead(track, selectedClipId, playheadMs)
      }
      return track
    })
    const newDuration = computeSequenceDuration(newTracks)
    setSequence({ ...sequence, tracks: newTracks, durationMs: newDuration })
    setSelectedClipId(null)
    markDirty()
  }, [sequence, selectedClipId, playheadMs, setSequence, setSelectedClipId, markDirty])

  const handleDeleteSelected = useCallback(() => {
    if (!sequence || !selectedClipId) return
    const newTracks = sequence.tracks.map((track) => removeClip(track, selectedClipId))
    const newDuration = computeSequenceDuration(newTracks)
    setSequence({ ...sequence, tracks: newTracks, durationMs: newDuration })
    setSelectedClipId(null)
    markDirty()
  }, [sequence, selectedClipId, setSequence, setSelectedClipId, markDirty])

  const handleAddCrossDissolve = useCallback(() => {
    if (!sequence) return
    const allClips = sequence.tracks.flatMap((t) => t.clips).sort((a, b) => a.startMs - b.startMs)
    for (let i = 0; i < allClips.length - 1; i++) {
      if (allClips[i].endMs === allClips[i + 1].startMs) {
        const newTransitions = addCrossDissolve(
          sequence.transitions ?? [],
          sequence.id,
          allClips[i].id,
          allClips[i + 1].id
        )
        setSequence({ ...sequence, transitions: newTransitions })
        markDirty()
        return
      }
    }
  }, [sequence, setSequence, markDirty])

  const handleAddCaption = useCallback(() => {
    if (!sequence) return
    let captionTrack = sequence.tracks.find((t) => t.kind === 'caption')
    let newTracks = [...sequence.tracks]

    if (!captionTrack) {
      captionTrack = createTrack('caption', 'Captions', sequence.tracks.length)
      captionTrack.sequenceId = sequence.id
      newTracks = [...newTracks, captionTrack]
    }

    const startMs = playheadMs
    const endMs = Math.min(startMs + 3000, 120_000)
    const updated = addCaption(captionTrack, 'New caption', startMs, endMs)

    newTracks = newTracks.map((t) => (t.id === updated.id ? updated : t))
    const newDuration = computeSequenceDuration(newTracks)
    setSequence({ ...sequence, tracks: newTracks, durationMs: newDuration })
    markDirty()
  }, [sequence, playheadMs, setSequence, markDirty])

  const handleSave = useCallback(async () => {
    if (!sequence || !sequence.id || !isDirty) return
    try {
      await saveMutation.mutateAsync({
        name: sequence.name,
        durationMs: sequence.durationMs,
        tracks: sequence.tracks,
        transitions: sequence.transitions,
      })
      useTimelineStore.getState().markClean()
    } catch {
      // error handled by mutation
    }
  }, [sequence, isDirty, saveMutation])

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    setPlayheadMs(Math.round(ratio * viewDurationMs))
  }, [viewDurationMs, setPlayheadMs])

  const tools = [
    { id: 'select' as const, icon: MousePointer2, label: 'Select (V)' },
    { id: 'cut' as const, icon: Scissors, label: 'Cut (C)' },
    { id: 'caption' as const, icon: Type, label: 'Caption (T)' },
  ]

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key.toLowerCase()) {
        case 'v': setActiveTool('select'); break
        case 'c': setActiveTool('cut'); break
        case 't': setActiveTool('caption'); break
        case ' ': e.preventDefault(); setIsPlaying(!useTimelineStore.getState().isPlaying); break
        case 'delete':
        case 'backspace': handleDeleteSelected(); break
        case 's':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleSave() }
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setActiveTool, setIsPlaying, handleDeleteSelected, handleSave])

  return (
    <div className={cn('relative flex flex-col gap-2', mounted ? 'timeline-enter' : 'opacity-0', className)}>
      {/* Full-width preview */}
      <div className="relative w-full aspect-video rounded-lg bg-black/70 border border-border/30 overflow-hidden timeline-scanline-boot">
        {previewClip ? (
          <video
            ref={previewVideoRef}
            key={previewClip.id}
            src={previewClip.fileUrl}
            className="w-full h-full object-contain"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/60 font-mono uppercase tracking-wider">
            Add a video clip to preview
          </div>
        )}
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/50 text-[10px] text-white font-mono tabular-nums">
          {msToTimecode(playheadMs)}
        </div>
      </div>

      {/* Controls row between preview and timeline */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/30 bg-muted/20 px-2.5 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-mono text-xs text-muted-foreground tabular-nums bg-muted/30 px-2 py-1 rounded-md border border-border/30 min-w-[90px] text-center">
            {msToTimecode(playheadMs)}
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                setPlayheadMs(0)
                setIsPlaying(false)
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Skip to start"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPlayheadMs(Math.max(0, playheadMs - 5000))}
              className="px-2 py-1 rounded-md text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Back 5 seconds"
            >
              -5s
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => setPlayheadMs(Math.min(durationMs, playheadMs + 5000))}
              className="px-2 py-1 rounded-md text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Forward 5 seconds"
            >
              +5s
            </button>
          </div>

          <div className="w-px h-4 bg-border/50" />

          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                activeTool === tool.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
              title={tool.label}
            >
              <tool.icon className="h-3.5 w-3.5" />
            </button>
          ))}

          <div className="w-px h-4 bg-border/50" />

          {activeTool === 'cut' && selectedClipId && (
            <button
              onClick={handleSplitAtPlayhead}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors border border-amber-500/30"
              title="Split at playhead"
            >
              <Scissors className="h-3 w-3" /> Split
            </button>
          )}

          <button
            onClick={handleAddCrossDissolve}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
            title="Add cross-dissolve between adjacent clips"
          >
            <X className="h-3 w-3 rotate-45" /> Dissolve
          </button>

          <button
            onClick={handleAddCaption}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
            title="Add caption at playhead"
          >
            <Type className="h-3 w-3" /> Caption
          </button>

          <div className="flex items-center gap-0.5 ml-auto">
            <button
              onClick={() => setZoom(zoom / 1.3)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <span className="text-[10px] text-muted-foreground font-mono w-8 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(zoom * 1.3)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>

          <button
            onClick={onOpenLibrary}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
          >
            <FolderOpen className="h-3 w-3" /> Library
          </button>

          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/30"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </button>
          )}

          <button
            onClick={() => setExportPanelOpen(!isExportPanelOpen)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors border',
              isExportPanelOpen
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border/30'
            )}
          >
            <Download className="h-3 w-3" /> Export
          </button>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wider">
          <span>Duration: {msToTimecode(durationMs)}</span>
          <span>|</span>
          <span>{sequence?.tracks.length ?? 0} tracks</span>
          <span>|</span>
          <span>{sequence?.fps ?? 30} fps</span>
          {isDirty && <span className="text-amber-500/80">| unsaved</span>}
        </div>
      </div>

      {/* Timeline Tracks Area */}
      <div ref={tracksAreaRef} className="relative bg-muted/20 border border-border/30 rounded-lg overflow-hidden min-h-[140px] timeline-glow">
        {/* Ruler */}
        <div className="h-6 bg-muted/30 border-b border-border/30 cursor-pointer" onClick={handleRulerClick}>
          <TrackRuler durationMs={viewDurationMs} />
        </div>

        {/* Track lanes */}
        <div className="relative">
          {(!sequence || sequence.tracks.length === 0) ? (
            <EmptyTrackPrompt onAddTrack={handleAddTrack} onOpenLibrary={onOpenLibrary} />
          ) : (
            <>
              {sequence.tracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  viewDurationMs={viewDurationMs}
                  selectedClipId={selectedClipId}
                  isSelectedTrack={selectedTrackId === track.id}
                  onSelectClip={setSelectedClipId}
                  onSelectTrack={setSelectedTrackId}
                  activeTool={activeTool}
                  playheadMs={playheadMs}
                />
              ))}
              {/* Add track buttons */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border/20">
                <button onClick={() => handleAddTrack('video')}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors">
                  <Plus className="h-2.5 w-2.5" /> Video
                </button>
                <button onClick={() => handleAddTrack('audio')}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors">
                  <Plus className="h-2.5 w-2.5" /> Audio
                </button>
                <button onClick={() => handleAddTrack('caption')}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors">
                  <Plus className="h-2.5 w-2.5" /> Caption
                </button>
              </div>
            </>
          )}

          {/* Playhead */}
          {viewDurationMs > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-primary z-10 pointer-events-none"
              style={{ left: `calc(80px + ${(playheadMs / viewDurationMs) * (100 - (80 / (tracksAreaRef.current?.clientWidth ?? 800)) * 100)}%)` }}
            >
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 bg-primary rounded-full shadow-sm shadow-primary/50" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TrackRuler({ durationMs }: { durationMs: number }) {
  const marks = useMemo(() => {
    const result: { ms: number; label: string; major: boolean }[] = []
    const step = durationMs <= 10000 ? 1000 : durationMs <= 30000 ? 2000 : 5000
    for (let ms = 0; ms <= durationMs; ms += step) {
      result.push({
        ms,
        label: `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`,
        major: ms % (step * 2) === 0,
      })
    }
    return result
  }, [durationMs])

  return (
    <div className="relative w-full h-full pl-[80px]">
      {marks.map((m) => (
        <div key={m.ms} className="absolute bottom-0 flex flex-col items-center"
          style={{ left: `${(m.ms / durationMs) * 100}%` }}>
          <span className={cn('text-[8px] font-mono leading-none mb-0.5', m.major ? 'text-muted-foreground/60' : 'text-muted-foreground/30')}>
            {m.major ? m.label : ''}
          </span>
          <div className={cn('w-px', m.major ? 'h-2 bg-muted-foreground/30' : 'h-1 bg-muted-foreground/15')} />
        </div>
      ))}
    </div>
  )
}

function TrackLane({
  track, viewDurationMs, selectedClipId, isSelectedTrack,
  onSelectClip, onSelectTrack, activeTool, playheadMs,
}: {
  track: TimelineTrack
  viewDurationMs: number
  selectedClipId: string | null
  isSelectedTrack: boolean
  onSelectClip: (id: string | null) => void
  onSelectTrack: (id: string | null) => void
  activeTool: string
  playheadMs: number
}) {
  const kindColors: Record<string, { bg: string; border: string; selected: string }> = {
    video: { bg: 'bg-primary/15', border: 'border-primary/25', selected: 'border-primary ring-1 ring-primary/30' },
    caption: { bg: 'bg-amber-500/15', border: 'border-amber-500/25', selected: 'border-amber-500 ring-1 ring-amber-500/30' },
    audio: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', selected: 'border-emerald-500 ring-1 ring-emerald-500/30' },
  }
  const colors = kindColors[track.kind] ?? kindColors.video

  return (
    <div
      className={cn('flex items-stretch h-10 border-b border-border/20 group', isSelectedTrack && 'bg-primary/5')}
      onClick={() => onSelectTrack(track.id)}
    >
      {/* Track label */}
      <div className="w-[80px] flex-shrink-0 flex items-center gap-1 px-2 border-r border-border/20">
        <GripVertical className="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
        <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider truncate flex-1">
          {track.label}
        </span>
        {track.kind === 'audio' && (
          <button className="p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors" title={track.isMuted ? 'Unmute' : 'Mute'}>
            {track.isMuted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
          </button>
        )}
      </div>

      {/* Clip area */}
      <div className="flex-1 relative">
        {/* Clips */}
        {track.clips.map((clip) => {
          const left = (clip.startMs / viewDurationMs) * 100
          const width = ((clip.endMs - clip.startMs) / viewDurationMs) * 100
          const isSelected = selectedClipId === clip.id

          return (
            <div
              key={clip.id}
              className={cn(
                'absolute top-1 bottom-1 rounded-md border cursor-pointer transition-all',
                colors.bg, colors.border,
                isSelected && colors.selected,
                activeTool === 'cut' && 'cursor-crosshair'
              )}
              style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }}
              onClick={(e) => { e.stopPropagation(); onSelectClip(clip.id) }}
              title={`${clip.fileType}: ${((clip.endMs - clip.startMs) / 1000).toFixed(1)}s`}
            >
              <span className="absolute inset-0 flex items-center px-1.5 text-[8px] text-foreground/60 truncate pointer-events-none">
                {((clip.endMs - clip.startMs) / 1000).toFixed(1)}s
              </span>
            </div>
          )
        })}

        {/* Captions as overlay blocks */}
        {(track.captions ?? []).map((cap) => {
          const left = (cap.startMs / viewDurationMs) * 100
          const width = ((cap.endMs - cap.startMs) / viewDurationMs) * 100
          return (
            <div
              key={cap.id}
              className="absolute top-0.5 bottom-0.5 rounded bg-amber-500/20 border border-amber-500/30 cursor-pointer"
              style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }}
              title={cap.text}
            >
              <span className="absolute inset-0 flex items-center px-1 text-[7px] text-amber-200/80 truncate pointer-events-none italic">
                {cap.text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyTrackPrompt({
  onAddTrack,
  onOpenLibrary,
}: {
  onAddTrack: (kind: 'video' | 'caption' | 'audio') => void
  onOpenLibrary: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground/40">
      <Plus className="h-6 w-6" />
      <span className="text-xs">Add tracks to start editing</span>
      <div className="flex gap-2">
        <button
          onClick={() => { onAddTrack('video'); onOpenLibrary() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/30"
        >
          <FolderOpen className="h-3 w-3" /> Browse Videos
        </button>
        <button
          onClick={() => onAddTrack('audio')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
        >
          <Volume2 className="h-3 w-3" /> Add Audio Track
        </button>
      </div>
    </div>
  )
}
