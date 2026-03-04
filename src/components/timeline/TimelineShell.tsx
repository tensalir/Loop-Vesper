'use client'

import { useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { useTimelineSequences, useCreateSequence } from '@/hooks/useTimeline'
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
  const { sequence, setSequence, setLibraryOpen, finishModeSwitch } = useTimelineStore()
  const { data: sequences, isLoading } = useTimelineSequences(projectId)
  const createMutation = useCreateSequence(projectId)

  useEffect(() => {
    finishModeSwitch()
  }, [finishModeSwitch])

  const ensureSequence = useCallback(
    (onReady?: () => void) => {
      if (sequence) {
        onReady?.()
        return
      }
      if (isLoading) return

      if (sequences && sequences.length > 0) {
        setSequence(sequences[0] as TimelineSequence)
        onReady?.()
        return
      }

      if (createMutation.isPending) return

      createMutation.mutate(
        { name: 'Sequence 1' },
        {
          onSuccess: (newSeq) => {
            setSequence(newSeq as TimelineSequence)
            onReady?.()
          },
        }
      )
    },
    [sequence, isLoading, sequences, setSequence, createMutation]
  )

  // Auto-load the most recent sequence or create one
  useEffect(() => {
    if (!sequence) ensureSequence()
  }, [sequence, ensureSequence])

  const handleOpenLibrary = useCallback(() => {
    ensureSequence(() => setLibraryOpen(true))
  }, [ensureSequence, setLibraryOpen])

  if (!sequence) {
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
