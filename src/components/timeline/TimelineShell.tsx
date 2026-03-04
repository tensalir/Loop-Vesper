'use client'

import { useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { useTimelineSequences, useCreateSequence } from '@/hooks/useTimeline'
import { createTrack, insertClip, computeSequenceDuration } from '@/lib/timeline/operations'
import type { TimelineSequence } from '@/types/timeline'

const TimelineEditor = dynamic(
  () => import('./TimelineEditor').then((mod) => mod.TimelineEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Loading editor…
      </div>
    ),
  }
)

interface TimelineShellProps {
  projectId: string
  className?: string
}

export function TimelineShell({ projectId, className }: TimelineShellProps) {
  const { sequence, setSequence, setLibraryOpen, markDirty, finishModeSwitch } = useTimelineStore()
  const { data: sequences, isLoading } = useTimelineSequences(projectId)
  const createMutation = useCreateSequence(projectId)

  useEffect(() => {
    finishModeSwitch()
  }, [finishModeSwitch])

  // Auto-load the most recent sequence or create one
  useEffect(() => {
    if (isLoading || sequence) return

    if (sequences && sequences.length > 0) {
      setSequence(sequences[0] as TimelineSequence)
    } else if (!createMutation.isPending) {
      createMutation.mutate(
        { name: 'Sequence 1' },
        {
          onSuccess: (newSeq) => {
            setSequence(newSeq as TimelineSequence)
          },
        }
      )
    }
  }, [isLoading, sequences, sequence, setSequence, createMutation])

  const handleOpenLibrary = useCallback(() => {
    setLibraryOpen(true)
  }, [setLibraryOpen])

  // Called from GenerationInterface when a video is selected from the library
  const handleInsertVideo = useCallback(
    (videoUrl: string, outputId: string, durationMs: number) => {
      const currentSequence = useTimelineStore.getState().sequence
      if (!currentSequence) return

      let tracks = [...currentSequence.tracks]
      let videoTrack = tracks.find((t) => t.kind === 'video')

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

      tracks = tracks.map((t) => (t.id === updatedTrack.id ? updatedTrack : t))
      const newDuration = computeSequenceDuration(tracks)

      setSequence({
        ...currentSequence,
        tracks,
        durationMs: newDuration,
      })
      markDirty()
    },
    [setSequence, markDirty]
  )

  // Expose the insert handler for parent components via the store
  useEffect(() => {
    ;(useTimelineStore as any)._insertVideo = handleInsertVideo
    return () => {
      delete (useTimelineStore as any)._insertVideo
    }
  }, [handleInsertVideo])

  if (isLoading && !sequence) {
    return (
      <div className={cn('flex items-center justify-center py-6 text-muted-foreground text-sm', className)}>
        Loading timeline…
      </div>
    )
  }

  return (
    <div className={cn('timeline-enter', className)}>
      <TimelineEditor projectId={projectId} onOpenLibrary={handleOpenLibrary} />
    </div>
  )
}
