'use client'

import { useCallback, useRef, useState, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import {
  Scissors, Type, MousePointer2, Play, Pause, SkipBack,
  FolderOpen, Download, Plus, ZoomIn, ZoomOut,
  Volume2, VolumeX, GripVertical, X, Save, Loader2,
  ChevronDown, Trash2, FilePlus2, Check, Camera,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { msToTimecode, type TimelineTrack, type TimelineClip, type TimelineTransition, type TimelineSequence } from '@/types/timeline'
import {
  createTrack, splitClipAtPlayhead, removeClip,
  addCrossDissolve, addCaption,
  computeSequenceDuration,
  trimClipLeft, trimClipRight,
  updateTransitionDuration,
  insertTrackAbove as insertTrackAboveOp,
} from '@/lib/timeline/operations'
import { captureCurrentFrameAsync } from '@/lib/video/captureFrame'

const LABEL_WIDTH = 80
const CLIP_JOIN_TOLERANCE_MS = 1
const PREVIEW_GAP_TOLERANCE_MS = 50

export interface SnapshotRequest {
  blob: Blob
  timelineMs: number
  timecodeMs: number
  clipId: string
  trackId: string
  isAtClipEnd: boolean
  fileUrl: string
  outputId: string | null
}

interface TimelineEditorProps {
  projectId: string
  onOpenLibrary: () => void
  onInsertFromLibrary?: (trackId: string, afterMs: number) => void
  sequences?: TimelineSequence[]
  onCreateSequence?: () => void
  onSwitchSequence?: (seq: TimelineSequence) => void
  onDeleteSequence?: (seqId: string) => void
  isCreating?: boolean
  className?: string
  onSnapshotRequest?: (req: SnapshotRequest) => void
  flushNow: () => Promise<void>
  isSaving: boolean
  isPromptMode?: boolean
  timelinePromptSlot?: ReactNode
}

export function TimelineEditor({
  projectId, onOpenLibrary, onInsertFromLibrary, sequences, onCreateSequence,
  onSwitchSequence, onDeleteSequence, isCreating, className,
  onSnapshotRequest, flushNow, isSaving, isPromptMode = false, timelinePromptSlot,
}: TimelineEditorProps) {
  const {
    sequence, playheadMs, zoom, isPlaying, activeTool,
    selectedClipId, selectedTrackId, isExportPanelOpen, snapshotPrompt,
    setSequence, setPlayheadMs, setZoom, setIsPlaying,
    setActiveTool, setSelectedClipId, setSelectedTrackId,
    setExportPanelOpen, markDirty, isDirty, finishModeSwitch,
  } = useTimelineStore()

  const tracksAreaRef = useRef<HTMLDivElement>(null)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const lastFrameCanvasRef = useRef<HTMLCanvasElement>(null)
  const activePreviewSrcRef = useRef<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [isSeqMenuOpen, setIsSeqMenuOpen] = useState(false)
  const seqMenuRef = useRef<HTMLDivElement>(null)
  const isDraggingPlayheadRef = useRef(false)

  useEffect(() => {
    setMounted(true)
    finishModeSwitch()
    return () => {
      setMounted(false)
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [finishModeSwitch])

  useEffect(() => {
    if (!isSeqMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (seqMenuRef.current && !seqMenuRef.current.contains(e.target as Node)) {
        setIsSeqMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isSeqMenuOpen])

  useEffect(() => {
    if (isPlaying && sequence) {
      playIntervalRef.current = setInterval(() => {
        const store = useTimelineStore.getState()
        const next = store.playheadMs + 33
        const endMs = store.sequence?.durationMs ?? 0
        if (next >= endMs) {
          store.setPlayheadMs(endMs)
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

  useEffect(() => {
    if (isPromptMode && isPlaying) {
      setIsPlaying(false)
    }
  }, [isPromptMode, isPlaying, setIsPlaying])

  const durationMs = sequence?.durationMs ?? 0
  const viewDurationMs = Math.max(durationMs, 10_000) / zoom
  const promptReferenceUrl = isPromptMode ? snapshotPrompt.snapshotUrl : null

  const previewClip = useMemo(() => {
    const videoClips = (sequence?.tracks ?? [])
      .filter((track) => track.kind === 'video')
      .flatMap((track) => track.clips)
      .sort((a, b) => a.startMs - b.startMs)
    if (videoClips.length === 0) return null

    const active = videoClips.find((clip) => playheadMs >= clip.startMs && playheadMs < clip.endMs)
    if (active) return active

    const first = videoClips[0]
    const last = videoClips[videoClips.length - 1]

    // Before first clip: preview first clip.
    if (playheadMs < first.startMs) return first
    // At/after timeline tail: keep showing the final clip.
    if (playheadMs >= last.endMs) return last

    // Between clips: bridge micro-gaps to avoid black-frame flicker at boundaries.
    for (let i = 0; i < videoClips.length - 1; i++) {
      const current = videoClips[i]
      const next = videoClips[i + 1]
      if (playheadMs >= current.endMs && playheadMs < next.startMs) {
        const gapMs = next.startMs - current.endMs
        if (gapMs <= PREVIEW_GAP_TOLERANCE_MS) return next
        return null
      }
    }

    return null
  }, [sequence, playheadMs])

  useLayoutEffect(() => {
    const video = previewVideoRef.current
    if (!video) return
    if (!previewClip) { video.pause(); return }

    const targetSrc = previewClip.fileUrl
    const srcChanged = activePreviewSrcRef.current !== targetSrc

    if (srcChanged) {
      const canvas = lastFrameCanvasRef.current
      if (canvas && video.readyState >= 2 && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(video, 0, 0)
        canvas.style.display = 'block'
      }

      activePreviewSrcRef.current = targetSrc
      video.src = targetSrc
      video.load()

      const hideCanvas = () => {
        if (lastFrameCanvasRef.current) lastFrameCanvasRef.current.style.display = 'none'
      }
      video.addEventListener('loadeddata', hideCanvas, { once: true })
      setTimeout(hideCanvas, 600)
    }

    const localMs = Math.max(
      previewClip.inPointMs,
      Math.min(previewClip.outPointMs, previewClip.inPointMs + Math.max(0, playheadMs - previewClip.startMs))
    )
    const nextTime = localMs / 1000
    if (!isPlaying) {
      if (Math.abs(video.currentTime - nextTime) > 0.005) {
        video.currentTime = nextTime
      }
      video.pause()
      return
    }
    if (Math.abs(video.currentTime - nextTime) > 0.08) {
      video.currentTime = nextTime
    }
    void video.play().catch(() => {})
  }, [previewClip, playheadMs, isPlaying])

  // ── Helpers to convert pixel positions to ms ──
  const pxToMs = useCallback((clientX: number) => {
    const el = tracksAreaRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left - LABEL_WIDTH
    const trackWidth = rect.width - LABEL_WIDTH
    if (trackWidth <= 0) return 0
    const ms = Math.round((x / trackWidth) * viewDurationMs)
    return Math.max(0, Math.min(ms, viewDurationMs))
  }, [viewDurationMs])

  // ── Draggable playhead ──
  const handlePlayheadDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingPlayheadRef.current = true
    setIsPlaying(false)
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingPlayheadRef.current) return
      setPlayheadMs(pxToMs(ev.clientX))
    }
    const onUp = () => {
      isDraggingPlayheadRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pxToMs, setPlayheadMs, setIsPlaying])

  const handleRulerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setPlayheadMs(pxToMs(e.clientX))
    setIsPlaying(false)
    isDraggingPlayheadRef.current = true
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingPlayheadRef.current) return
      setPlayheadMs(pxToMs(ev.clientX))
    }
    const onUp = () => {
      isDraggingPlayheadRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pxToMs, setPlayheadMs, setIsPlaying])

  // ── Track operations ──
  const handleAddTrack = useCallback((kind: 'video' | 'caption' | 'audio') => {
    if (!sequence) return
    const sortOrder = sequence.tracks.length
    const track = createTrack(kind, undefined, sortOrder)
    track.sequenceId = sequence.id
    setSequence({ ...sequence, tracks: [...sequence.tracks, track] })
    markDirty()
  }, [sequence, setSequence, markDirty])

  const handleAddTrackAbove = useCallback((kind: 'video' | 'caption' | 'audio') => {
    if (!sequence || !selectedTrackId) return
    const { tracks } = insertTrackAboveOp(sequence.tracks, selectedTrackId, kind)
    const reordered = tracks.map((t) => ({ ...t, sequenceId: sequence.id }))
    setSequence({ ...sequence, tracks: reordered })
    markDirty()
  }, [sequence, selectedTrackId, setSequence, markDirty])

  // ── Cut: clicking a clip in cut mode splits at playhead ──
  const handleClipClick = useCallback((clipId: string, trackId: string) => {
    if (activeTool === 'cut') {
      if (!sequence) return
      const newTracks = sequence.tracks.map((track) => {
        if (track.id === trackId && track.clips.some((c) => c.id === clipId)) {
          return splitClipAtPlayhead(track, clipId, playheadMs)
        }
        return track
      })
      const newDuration = computeSequenceDuration(newTracks)
      setSequence({ ...sequence, tracks: newTracks, durationMs: newDuration })
      setSelectedClipId(null)
      markDirty()
    } else {
      setSelectedClipId(clipId)
      setSelectedTrackId(trackId)
    }
  }, [activeTool, sequence, playheadMs, setSequence, setSelectedClipId, setSelectedTrackId, markDirty])

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
    let transitions = sequence.transitions ?? []
    let added = false
    for (const track of sequence.tracks) {
      const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs)
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].endMs === sorted[i + 1].startMs) {
          const alreadyExists = transitions.some(
            (t) => t.fromClipId === sorted[i].id && t.toClipId === sorted[i + 1].id
          )
          if (!alreadyExists) {
            transitions = addCrossDissolve(transitions, sequence.id, sorted[i].id, sorted[i + 1].id)
            added = true
          }
        }
      }
    }
    if (added) {
      setSequence({ ...sequence, transitions })
      markDirty()
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

  // ── Trim handler (called from TrackLane) ──
  const handleTrim = useCallback((trackId: string, clipId: string, edge: 'left' | 'right', newMs: number) => {
    if (!sequence) return
    const newTracks = sequence.tracks.map((track) => {
      if (track.id !== trackId) return track
      return edge === 'left'
        ? trimClipLeft(track, clipId, newMs)
        : trimClipRight(track, clipId, newMs)
    })
    const newDuration = computeSequenceDuration(newTracks)
    setSequence({ ...sequence, tracks: newTracks, durationMs: newDuration })
    markDirty()
  }, [sequence, setSequence, markDirty])

  // ── Track mute toggle ──
  const handleToggleMute = useCallback((trackId: string) => {
    if (!sequence) return
    const newTracks = sequence.tracks.map((t) =>
      t.id === trackId ? { ...t, isMuted: !t.isMuted } : t
    )
    setSequence({ ...sequence, tracks: newTracks })
    markDirty()
  }, [sequence, setSequence, markDirty])

  // ── Dissolve duration drag ──
  const handleDissolveDurationChange = useCallback((transitionId: string, newDurationMs: number) => {
    if (!sequence) return
    const updated = updateTransitionDuration(sequence.transitions ?? [], transitionId, newDurationMs)
    setSequence({ ...sequence, transitions: updated })
    markDirty()
  }, [sequence, setSequence, markDirty])

  // ── Snapshot capture from explicit timeline pointer position ──
  const handleSnapshotAtPoint = useCallback(async (clip: TimelineClip, trackId: string, targetMs: number) => {
    if (!onSnapshotRequest) return
    if (!clip.outputId) return

    const clampTargetMs = Math.max(clip.startMs, Math.min(clip.endMs, Math.round(targetMs)))
    const localMs = Math.max(
      clip.inPointMs,
      Math.min(clip.outPointMs, clip.inPointMs + Math.max(0, clampTargetMs - clip.startMs))
    )
    const seekSec = localMs / 1000

    setIsPlaying(false)
    setPlayheadMs(clampTargetMs)

    let frame: Awaited<ReturnType<typeof captureCurrentFrameAsync>> | null = null

    const canUsePreview = previewClip?.id === clip.id && !!previewVideoRef.current
    if (canUsePreview) {
      const previewEl = previewVideoRef.current!
      if (Math.abs(previewEl.currentTime - seekSec) > 0.005) {
        previewEl.currentTime = seekSec
        await new Promise<void>((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            previewEl.removeEventListener('seeked', finish)
            resolve()
          }
          previewEl.addEventListener('seeked', finish, { once: true })
          window.setTimeout(finish, 250)
        })
      }
      frame = await captureCurrentFrameAsync(previewEl)
    } else {
      const probe = document.createElement('video')
      probe.crossOrigin = 'anonymous'
      probe.muted = true
      probe.playsInline = true
      probe.preload = 'auto'
      probe.src = clip.fileUrl

      await new Promise<void>((resolve) => {
        if (probe.readyState >= 1) {
          resolve()
          return
        }
        let done = false
        const finish = () => {
          if (done) return
          done = true
          probe.removeEventListener('loadedmetadata', finish)
          probe.removeEventListener('error', finish)
          resolve()
        }
        probe.addEventListener('loadedmetadata', finish, { once: true })
        probe.addEventListener('error', finish, { once: true })
        window.setTimeout(finish, 600)
      })

      probe.currentTime = seekSec
      await new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          probe.removeEventListener('seeked', finish)
          resolve()
        }
        probe.addEventListener('seeked', finish, { once: true })
        window.setTimeout(finish, 250)
      })
      frame = await captureCurrentFrameAsync(probe)
      probe.pause()
      probe.removeAttribute('src')
      probe.load()
    }

    if (!frame) return

    const clipEndThreshold = 200
    const isAtEnd = (clip.endMs - clampTargetMs) <= clipEndThreshold
    onSnapshotRequest({
      blob: frame.blob,
      timelineMs: clampTargetMs,
      timecodeMs: Math.round(localMs),
      clipId: clip.id,
      trackId,
      isAtClipEnd: isAtEnd,
      fileUrl: clip.fileUrl,
      outputId: clip.outputId,
    })
    URL.revokeObjectURL(frame.objectUrl)
  }, [onSnapshotRequest, previewClip, setIsPlaying, setPlayheadMs])

  const handleSave = useCallback(async () => {
    if (!sequence || !sequence.id || !isDirty) return
    await flushNow()
  }, [sequence, isDirty, flushNow])

  const tools = [
    { id: 'select' as const, icon: MousePointer2, label: 'Select (V)' },
    { id: 'cut' as const, icon: Scissors, label: 'Cut (C)' },
    { id: 'caption' as const, icon: Type, label: 'Caption (T)' },
  ]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (isPromptMode) return
      switch (e.key.toLowerCase()) {
        case 'v': setActiveTool('select'); break
        case 'c': setActiveTool('cut'); break
        case 't': setActiveTool('caption'); break
        case ' ': {
          e.preventDefault()
          const s = useTimelineStore.getState()
          if (!s.isPlaying && (s.sequence?.durationMs ?? 0) > 0 && s.playheadMs >= (s.sequence?.durationMs ?? 0) - 100) {
            s.setPlayheadMs(0)
          }
          s.setIsPlaying(!s.isPlaying)
          break
        }
        case 'delete':
        case 'backspace': handleDeleteSelected(); break
        case 's':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleSave() }
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isPromptMode, setActiveTool, setIsPlaying, handleDeleteSelected, handleSave])

  // ── Playhead position calc ──
  const playheadLeft = useMemo(() => {
    if (viewDurationMs <= 0) return '80px'
    const areaWidth = tracksAreaRef.current?.clientWidth ?? 800
    const trackWidth = areaWidth - LABEL_WIDTH
    const px = LABEL_WIDTH + (playheadMs / viewDurationMs) * trackWidth
    return `${px}px`
  }, [playheadMs, viewDurationMs])

  // All transitions indexed by fromClipId for dissolve rendering
  const transitionsByFrom = useMemo(() => {
    const map = new Map<string, TimelineTransition>()
    for (const t of sequence?.transitions ?? []) {
      map.set(t.fromClipId, t)
    }
    return map
  }, [sequence?.transitions])

  return (
    <div className={cn('relative flex flex-col gap-2', mounted ? 'timeline-enter' : 'opacity-0', className)}>
      {/* Sequence selector */}
      {sequences && sequences.length > 0 && (
        <div className="flex items-center gap-2" ref={seqMenuRef}>
          <div className="relative">
            <button
              onClick={() => setIsSeqMenuOpen(!isSeqMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-foreground/80 hover:text-foreground bg-muted/30 hover:bg-muted/50 border border-border/30 transition-colors"
            >
              <span className="max-w-[180px] truncate">{sequence?.name || 'Select edit'}</span>
              <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', isSeqMenuOpen && 'rotate-180')} />
            </button>

            {isSeqMenuOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl shadow-xl py-1">
                {sequences.map((seq) => (
                  <button
                    key={seq.id}
                    onClick={() => { onSwitchSequence?.(seq); setIsSeqMenuOpen(false) }}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors group/item',
                      seq.id === sequence?.id ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {seq.id === sequence?.id && <Check className="h-3 w-3 flex-shrink-0" />}
                    <span className={cn('flex-1 truncate', seq.id !== sequence?.id && 'ml-5')}>{seq.name}</span>
                    <span className="text-[9px] text-muted-foreground/50 font-mono tabular-nums">{seq.tracks?.length ?? 0}t</span>
                    {sequences.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteSequence?.(seq.id); setIsSeqMenuOpen(false) }}
                        className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded text-muted-foreground/40 hover:text-red-400 transition-all"
                        title="Delete this edit"
                      ><Trash2 className="h-3 w-3" /></button>
                    )}
                  </button>
                ))}
                <div className="h-px bg-border/30 my-1" />
                <button
                  onClick={() => { onCreateSequence?.(); setIsSeqMenuOpen(false) }}
                  disabled={isCreating}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                >
                  <FilePlus2 className="h-3 w-3" /><span>New edit</span>
                  {isCreating && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
                </button>
              </div>
            )}
          </div>
          {isDirty && <span className="text-[9px] text-amber-500/80 font-mono uppercase tracking-wider">unsaved</span>}
        </div>
      )}

      {/* Snapshot prompt shell: single frame around preview + prompt area */}
      <div
        className={cn(
          'flex flex-col gap-2',
          isPromptMode && 'rounded-lg border border-primary/35 bg-primary/[0.03] shadow-[0_0_0_1px_rgba(74,222,128,0.12),0_0_24px_rgba(74,222,128,0.16)] p-2'
        )}
      >
      {/* Preview — slightly reduced height */}
      <div
        className={cn(
          'relative w-full rounded-lg bg-black/70 overflow-hidden timeline-scanline-boot',
          isPromptMode ? 'border border-transparent' : 'border border-border/30'
        )}
        style={{ aspectRatio: '16 / 8.2' }}
      >
        {promptReferenceUrl ? (
          <>
            <img
              src={promptReferenceUrl}
              alt="Reference frame for generation"
              className="w-full h-full object-contain"
            />
            <div className="absolute top-2 right-2 px-2 py-1 rounded bg-primary/85 text-[10px] text-primary-foreground font-mono uppercase tracking-wider">
              Reference Frame
            </div>
          </>
        ) : (
          <>
            <canvas
              ref={lastFrameCanvasRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
              style={{ display: 'none' }}
            />
            <video
              ref={previewVideoRef}
              className={cn('w-full h-full object-contain', !previewClip && 'hidden')}
              crossOrigin="anonymous"
              muted playsInline preload="auto"
            />
            {!previewClip && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/60 font-mono uppercase tracking-wider">
                Add a video clip to preview
              </div>
            )}
          </>
        )}
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/50 text-[10px] text-white font-mono tabular-nums">
          {msToTimecode(playheadMs)}
        </div>
      </div>

      {/* Controls */}
      {!isPromptMode && (
      <div className="flex flex-col gap-2 rounded-lg border border-border/30 bg-muted/20 px-2.5 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-mono text-xs text-muted-foreground tabular-nums bg-muted/30 px-2 py-1 rounded-md border border-border/30 min-w-[90px] text-center">
            {msToTimecode(playheadMs)}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => { setPlayheadMs(0); setIsPlaying(false) }} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Skip to start">
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPlayheadMs(Math.max(0, playheadMs - 5000))} className="px-2 py-1 rounded-md text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Back 5 seconds">-5s</button>
            <button onClick={() => {
              if (!isPlaying && durationMs > 0 && playheadMs >= durationMs - 100) {
                setPlayheadMs(0)
              }
              setIsPlaying(!isPlaying)
            }} className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors" title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => setPlayheadMs(Math.min(durationMs, playheadMs + 5000))} className="px-2 py-1 rounded-md text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Forward 5 seconds">+5s</button>
          </div>
          <div className="w-px h-4 bg-border/50" />
          {tools.map((tool) => (
            <button key={tool.id} onClick={() => setActiveTool(tool.id)}
              className={cn('p-1.5 rounded-md transition-colors', activeTool === tool.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60')}
              title={tool.label}
            ><tool.icon className="h-3.5 w-3.5" /></button>
          ))}
          <div className="w-px h-4 bg-border/50" />

          {activeTool === 'cut' && selectedClipId && (
            <button onClick={handleSplitAtPlayhead}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors border border-amber-500/30"
              title="Split at playhead"
            ><Scissors className="h-3 w-3" /> Split</button>
          )}

          <button onClick={handleAddCrossDissolve}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
            title="Add cross-dissolve between adjacent clips"
          ><X className="h-3 w-3 rotate-45" /> Dissolve</button>

          <button onClick={handleAddCaption}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
            title="Add caption at playhead"
          ><Type className="h-3 w-3" /> Caption</button>

          <div className="flex items-center gap-0.5 ml-auto">
            <button onClick={() => setZoom(zoom / 1.3)} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"><ZoomOut className="h-3 w-3" /></button>
            <span className="text-[10px] text-muted-foreground font-mono w-8 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(zoom * 1.3)} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"><ZoomIn className="h-3 w-3" /></button>
          </div>

          <button onClick={onOpenLibrary}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
          ><FolderOpen className="h-3 w-3" /> Library</button>

          {(isDirty || isSaving) && (
            <button onClick={handleSave} disabled={isSaving}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/30"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          )}

          <button onClick={() => setExportPanelOpen(!isExportPanelOpen)}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors border',
              isExportPanelOpen ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border/30'
            )}
          ><Download className="h-3 w-3" /> Export</button>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wider">
          <span>Duration: {msToTimecode(durationMs)}</span><span>|</span>
          <span>{sequence?.tracks.length ?? 0} tracks</span><span>|</span>
          <span>{sequence?.fps ?? 30} fps</span>
          {isDirty && <span className="text-amber-500/80">| unsaved</span>}
        </div>
      </div>
      )}

      {/* Timeline Tracks Area */}
      <div
        ref={tracksAreaRef}
        className={cn(
          'relative rounded-lg overflow-visible min-h-[160px]',
          isPromptMode
            ? 'bg-transparent border border-transparent max-h-[36vh]'
            : 'bg-muted/20 border border-border/30 timeline-glow'
        )}
      >
        {isPromptMode && timelinePromptSlot ? (
          <div className="p-3 min-h-[160px] max-h-[36vh] overflow-y-auto timeline-morph-in">
            {timelinePromptSlot}
          </div>
        ) : (
          <>
            {/* Ruler — draggable */}
            <div className="h-6 bg-muted/30 border-b border-border/30 cursor-pointer select-none rounded-t-lg" onMouseDown={handleRulerMouseDown}>
              <TrackRuler durationMs={viewDurationMs} />
            </div>

            {/* Track lanes — scrollable when stacked */}
            <div className="relative overflow-y-auto overflow-x-clip scrollbar-hide rounded-b-lg bg-muted/20" style={{ maxHeight: 'calc(100% - 24px)' }}>
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
                      onClipClick={handleClipClick}
                      onSelectTrack={setSelectedTrackId}
                      activeTool={activeTool}
                      onTrim={handleTrim}
                      pxToMs={pxToMs}
                      transitions={transitionsByFrom}
                      onDissolveDurationChange={handleDissolveDurationChange}
                      onSnapshotAtPoint={onSnapshotRequest ? handleSnapshotAtPoint : undefined}
                      onInsertFromLibrary={onInsertFromLibrary}
                      onToggleMute={handleToggleMute}
                    />
                  ))}
                  {/* Add track buttons */}
                  <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border/20">
                    <button onClick={() => handleAddTrack('video')} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors"><Plus className="h-2.5 w-2.5" /> Video</button>
                    <button onClick={() => handleAddTrack('audio')} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors"><Plus className="h-2.5 w-2.5" /> Audio</button>
                    <button onClick={() => handleAddTrack('caption')} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors"><Plus className="h-2.5 w-2.5" /> Caption</button>
                    {selectedTrackId && (
                      <button onClick={() => handleAddTrackAbove('video')} className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-muted-foreground/60 hover:text-foreground rounded border border-dashed border-border/30 hover:border-border/60 transition-colors ml-auto"><Plus className="h-2.5 w-2.5" /> Above</button>
                    )}
                  </div>
                </>
              )}

              {/* Playhead overlay — the wider hit-area covers the full vertical line */}
              {viewDurationMs > 0 && (
                <div
                  className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
                  style={{ left: `calc(${playheadLeft} - 5px)`, width: '11px' }}
                  onMouseDown={handlePlayheadDragStart}
                >
                  <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-primary pointer-events-none" />
                  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-sm shadow-sm shadow-primary/50 pointer-events-none" />
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}

// ── ClipFilmstrip — renders evenly-spaced video frame thumbnails across the clip ──

const FILMSTRIP_THUMB_WIDTH = 40

function ClipFilmstrip({
  fileUrl,
  clipDurationMs,
  flushLeft = false,
  flushRight = false,
}: {
  fileUrl: string
  clipDurationMs: number
  flushLeft?: boolean
  flushRight?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const [slotCount, setSlotCount] = useState(0)
  const generationIdRef = useRef(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setSlotCount(Math.max(1, Math.floor(width / FILMSTRIP_THUMB_WIDTH)))
    })
    observer.observe(el)
    setSlotCount(Math.max(1, Math.floor(el.clientWidth / FILMSTRIP_THUMB_WIDTH)))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (slotCount === 0) return
    const genId = ++generationIdRef.current

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = fileUrl

    let cancelled = false

    const captureFrames = async () => {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) { resolve(); return }
        const done = () => { video.removeEventListener('loadedmetadata', done); video.removeEventListener('error', done); resolve() }
        video.addEventListener('loadedmetadata', done, { once: true })
        video.addEventListener('error', done, { once: true })
        setTimeout(done, 2000)
      })
      if (cancelled || genId !== generationIdRef.current) return

      const duration = video.duration
      if (!duration || !isFinite(duration)) return

      for (let i = 0; i < slotCount; i++) {
        if (cancelled || genId !== generationIdRef.current) break
        const seekTime = (i / Math.max(1, slotCount - 1)) * duration * 0.95
        video.currentTime = seekTime
        await new Promise<void>((resolve) => {
          const finish = () => { video.removeEventListener('seeked', finish); resolve() }
          video.addEventListener('seeked', finish, { once: true })
          setTimeout(finish, 300)
        })
        if (cancelled || genId !== generationIdRef.current) break

        const canvas = canvasRefs.current[i]
        if (!canvas) continue
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const vw = video.videoWidth || 64
        const vh = video.videoHeight || 36
        canvas.width = FILMSTRIP_THUMB_WIDTH
        canvas.height = Math.round((FILMSTRIP_THUMB_WIDTH / vw) * vh)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      }

      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    captureFrames()

    return () => {
      cancelled = true
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [fileUrl, slotCount, clipDurationMs])

  canvasRefs.current.length = slotCount

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute inset-0 flex overflow-hidden opacity-50 pointer-events-none',
        !flushLeft && !flushRight && 'rounded-md',
        flushLeft && 'rounded-l-none',
        flushRight && 'rounded-r-none'
      )}
    >
      {Array.from({ length: slotCount }, (_, i) => (
        <canvas
          key={i}
          ref={(el) => { canvasRefs.current[i] = el }}
          className="h-full flex-shrink-0 object-cover"
          style={{ width: `${100 / slotCount}%` }}
        />
      ))}
    </div>
  )
}

// ── TrackRuler ──

function TrackRuler({ durationMs }: { durationMs: number }) {
  const marks = useMemo(() => {
    const result: { ms: number; label: string; major: boolean }[] = []
    const step = durationMs <= 10000 ? 1000 : durationMs <= 30000 ? 2000 : 5000
    for (let ms = 0; ms <= durationMs; ms += step) {
      result.push({ ms, label: `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`, major: ms % (step * 2) === 0 })
    }
    return result
  }, [durationMs])

  return (
    <div className="relative w-full h-full pl-[80px]">
      {marks.map((m) => (
        <div key={m.ms} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${(m.ms / durationMs) * 100}%` }}>
          <span className={cn('text-[8px] font-mono leading-none mb-0.5', m.major ? 'text-muted-foreground/60' : 'text-muted-foreground/30')}>
            {m.major ? m.label : ''}
          </span>
          <div className={cn('w-px', m.major ? 'h-2 bg-muted-foreground/30' : 'h-1 bg-muted-foreground/15')} />
        </div>
      ))}
    </div>
  )
}

// ── TrackLane with trim handles and dissolve chips ──

function TrackLane({
  track, viewDurationMs, selectedClipId, isSelectedTrack,
  onClipClick, onSelectTrack, activeTool,
  onTrim, pxToMs, transitions, onDissolveDurationChange,
  onSnapshotAtPoint, onInsertFromLibrary, onToggleMute,
}: {
  track: TimelineTrack
  viewDurationMs: number
  selectedClipId: string | null
  isSelectedTrack: boolean
  onClipClick: (clipId: string, trackId: string) => void
  onSelectTrack: (id: string | null) => void
  activeTool: string
  onTrim: (trackId: string, clipId: string, edge: 'left' | 'right', newMs: number) => void
  pxToMs: (clientX: number) => number
  transitions: Map<string, TimelineTransition>
  onDissolveDurationChange: (transitionId: string, newDurationMs: number) => void
  onSnapshotAtPoint?: (clip: TimelineClip, trackId: string, targetMs: number) => void
  onInsertFromLibrary?: (trackId: string, afterMs: number) => void
  onToggleMute: (trackId: string) => void
}) {
  const kindColors: Record<string, { bg: string; border: string; selected: string }> = {
    video: { bg: 'bg-primary/15', border: 'border-primary/25', selected: 'border-primary ring-1 ring-primary/30' },
    caption: { bg: 'bg-amber-500/15', border: 'border-amber-500/25', selected: 'border-amber-500 ring-1 ring-amber-500/30' },
    audio: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', selected: 'border-emerald-500 ring-1 ring-emerald-500/30' },
  }
  const colors = kindColors[track.kind] ?? kindColors.video

  const handleTrimDrag = useCallback((clipId: string, edge: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const onMove = (ev: MouseEvent) => {
      onTrim(track.id, clipId, edge, pxToMs(ev.clientX))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [track.id, onTrim, pxToMs])

  const handleDissolveDrag = useCallback((transitionId: string, baseDurationMs: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startMs = pxToMs(startX)
    const onMove = (ev: MouseEvent) => {
      const currentMs = pxToMs(ev.clientX)
      const delta = currentMs - startMs
      onDissolveDurationChange(transitionId, baseDurationMs + delta)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [onDissolveDurationChange, pxToMs])

  const sortedClips = useMemo(() => [...track.clips].sort((a, b) => a.startMs - b.startMs), [track.clips])
  const [snapshotCursor, setSnapshotCursor] = useState<{ clipId: string; ratio: number } | null>(null)

  return (
    <div
      className={cn('flex items-stretch h-12 border-b border-border/20 group/lane relative', isSelectedTrack && 'bg-primary/5')}
      onClick={() => onSelectTrack(track.id)}
    >
      <div className="w-[80px] flex-shrink-0 flex items-center gap-1 px-2 border-r border-border/20">
        <GripVertical className="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover/lane:opacity-100 transition-opacity cursor-grab" />
        <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider truncate flex-1">{track.label}</span>
        {track.kind === 'audio' && (
          <button
            className="p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
            title={track.isMuted ? 'Unmute' : 'Mute'}
            onClick={(e) => { e.stopPropagation(); onToggleMute(track.id) }}
          >
            {track.isMuted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
          </button>
        )}
      </div>

      <div className="flex-1 relative">
        {sortedClips.map((clip, idx) => {
          const left = (clip.startMs / viewDurationMs) * 100
          const width = ((clip.endMs - clip.startMs) / viewDurationMs) * 100
          const isSelected = selectedClipId === clip.id
          const dissolve = transitions.get(clip.id)
          const isPlaceholder = clip.fileUrl.startsWith('placeholder:')
          const prevClip = idx > 0 ? sortedClips[idx - 1] : null
          const nextClip = idx < sortedClips.length - 1 ? sortedClips[idx + 1] : null
          const touchesPrev = !!prevClip && Math.abs(clip.startMs - prevClip.endMs) <= CLIP_JOIN_TOLERANCE_MS
          const touchesNext = !!nextClip && Math.abs(nextClip.startMs - clip.endMs) <= CLIP_JOIN_TOLERANCE_MS
          const clipWidth = Math.max(0.5, width)

          return (
            <div key={clip.id} className="contents">
              {/* Hover zone — extends above and below the clip for snapshot cursor detection; button lives here so hover is unbroken */}
              {!isPlaceholder && onSnapshotAtPoint && clip.fileType === 'video' && clip.outputId && (
                <div
                  className="absolute z-[15]"
                  style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%`, top: 0, bottom: 0 }}
                  onMouseMove={(e) => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                    if (rect.width <= 0) return
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                    setSnapshotCursor({ clipId: clip.id, ratio })
                  }}
                  onMouseLeave={() => {
                    setSnapshotCursor((current) => (current?.clipId === clip.id ? null : current))
                  }}
                >
                  {snapshotCursor?.clipId === clip.id && (
                    <button
                      className="absolute w-7 h-7 rounded-full bg-muted/90 text-foreground backdrop-blur-sm border border-border/50 shadow-md flex items-center justify-center hover:bg-muted hover:scale-110 transition-all"
                      style={{ top: '50%', left: `${snapshotCursor.ratio * 100}%`, transform: 'translate(-50%, -100%)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        const targetMs = clip.startMs + (clip.endMs - clip.startMs) * snapshotCursor.ratio
                        onSnapshotAtPoint(clip, track.id, targetMs)
                      }}
                      title="Capture snapshot at this frame"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              {/* Clip block */}
              <div
                className={cn(
                  'absolute top-3 bottom-1 rounded-md border cursor-pointer transition-colors overflow-visible group/clip',
                  touchesPrev && 'rounded-l-none',
                  touchesNext && 'rounded-r-none',
                  isPlaceholder
                    ? 'border-primary/40 bg-primary/[0.07] timeline-clip-generating'
                    : cn(colors.bg, colors.border),
                  isSelected && !isPlaceholder && colors.selected,
                  activeTool === 'cut' && !isPlaceholder && 'cursor-crosshair'
                )}
                style={{
                  left: `${left}%`,
                  width: touchesNext ? `calc(${clipWidth}% + 1px)` : `${clipWidth}%`,
                }}
                onClick={(e) => { e.stopPropagation(); if (!isPlaceholder) onClipClick(clip.id, track.id) }}
                title={isPlaceholder ? 'Generating…' : `${clip.fileType}: ${((clip.endMs - clip.startMs) / 1000).toFixed(1)}s`}
              >
                {isPlaceholder ? (
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] text-primary/70 font-mono uppercase tracking-wider pointer-events-none">
                    Generating… {((clip.endMs - clip.startMs) / 1000).toFixed(0)}s
                  </span>
                ) : (
                  <>
                {clip.fileType === 'video' && (
                  <ClipFilmstrip
                    fileUrl={clip.fileUrl}
                    clipDurationMs={clip.endMs - clip.startMs}
                    flushLeft={touchesPrev}
                    flushRight={touchesNext}
                  />
                )}
                <span className="absolute inset-0 flex items-center justify-center text-[8px] text-foreground/70 font-mono tabular-nums truncate pointer-events-none z-[1] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                  {((clip.endMs - clip.startMs) / 1000).toFixed(1)}s
                </span>
                  </>
                )}

                {!isPlaceholder && (
                  <>
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-transparent hover:bg-primary/40 rounded-l-md transition-colors z-20"
                  onMouseDown={(e) => handleTrimDrag(clip.id, 'left', e)}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-transparent hover:bg-primary/40 rounded-r-md transition-colors z-20"
                  onMouseDown={(e) => handleTrimDrag(clip.id, 'right', e)}
                />

                {onInsertFromLibrary && (
                  <button
                    className="absolute z-20 w-5 h-5 rounded-full bg-muted/80 text-muted-foreground hover:text-foreground backdrop-blur-sm border border-border/40 shadow-sm flex items-center justify-center opacity-0 group-hover/clip:opacity-100 hover:scale-110 transition-all"
                    style={{ top: '50%', right: '-12px', transform: 'translateY(-50%)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onInsertFromLibrary(track.id, clip.endMs)
                    }}
                    title="Insert video from library"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
                  </>
                )}
              </div>

              {/* Dissolve handle between this clip and next */}
              {dissolve && idx < sortedClips.length - 1 && (() => {
                const nextClip = sortedClips[idx + 1]
                const dissolveLeft = (clip.endMs / viewDurationMs) * 100
                const dissolveWidth = Math.max(0.3, (dissolve.durationMs / viewDurationMs) * 100)
                return (
                  <div
                    key={`dissolve-${dissolve.id}`}
                    className="absolute top-0 bottom-0 bg-primary/10 border-x border-primary/30 cursor-ew-resize z-10 flex items-center justify-center"
                    style={{ left: `${dissolveLeft - dissolveWidth / 2}%`, width: `${dissolveWidth}%` }}
                    onMouseDown={(e) => handleDissolveDrag(dissolve.id, dissolve.durationMs, e)}
                    title={`Dissolve: ${(dissolve.durationMs / 1000).toFixed(1)}s — drag to resize`}
                  >
                    <X className="h-2.5 w-2.5 rotate-45 text-primary/50 pointer-events-none" />
                  </div>
                )
              })()}
            </div>
          )
        })}

        {(track.captions ?? []).map((cap) => {
          const left = (cap.startMs / viewDurationMs) * 100
          const width = ((cap.endMs - cap.startMs) / viewDurationMs) * 100
          return (
            <div key={cap.id} className="absolute top-0.5 bottom-0.5 rounded bg-amber-500/20 border border-amber-500/30 cursor-pointer"
              style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }}
              title={cap.text}
            >
              <span className="absolute inset-0 flex items-center px-1 text-[7px] text-amber-200/80 truncate pointer-events-none italic">{cap.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── EmptyTrackPrompt ──

function EmptyTrackPrompt({
  onAddTrack, onOpenLibrary,
}: {
  onAddTrack: (kind: 'video' | 'caption' | 'audio') => void
  onOpenLibrary: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground/40">
      <Plus className="h-6 w-6" />
      <span className="text-xs">Add tracks to start editing</span>
      <div className="flex gap-2">
        <button onClick={() => { onAddTrack('video'); onOpenLibrary() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/30"
        ><FolderOpen className="h-3 w-3" /> Browse Videos</button>
        <button onClick={() => onAddTrack('audio')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-border/30"
        ><Volume2 className="h-3 w-3" /> Add Audio Track</button>
      </div>
    </div>
  )
}
