'use client'

import { useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { useTimelineSequences, useCreateSequence, useDeleteSequence } from '@/hooks/useTimeline'
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
  const { sequence, setSequence, setLibraryOpen, finishModeSwitch, resetTimeline } = useTimelineStore()
  const { data: sequences, isLoading, refetch: refetchSequences } = useTimelineSequences(projectId)
  const createMutation = useCreateSequence(projectId)
  const deleteMutation = useDeleteSequence(projectId)
  const didBootstrapRef = useRef(false)

  useEffect(() => {
    finishModeSwitch()
  }, [finishModeSwitch])

  const ensureSequence = useCallback(
    (onReady?: () => void, forceCreate = false) => {
      if (sequence) {
        onReady?.()
        return
      }
      if (isLoading && !forceCreate) return

      if (sequences && sequences.length > 0) {
        setSequence(sequences[0] as TimelineSequence)
        onReady?.()
        return
      }

      if (!forceCreate && didBootstrapRef.current) return
      if (createMutation.isPending) return
      didBootstrapRef.current = true

      createMutation.mutate(
        { name: 'Edit 1' },
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

  useEffect(() => {
    if (!sequence) ensureSequence()
  }, [sequence, ensureSequence])

  const handleOpenLibrary = useCallback(() => {
    setLibraryOpen(true)
    ensureSequence(undefined, true)
  }, [ensureSequence, setLibraryOpen])

  const handleCreateSequence = useCallback(() => {
    const nextNumber = (sequences?.length ?? 0) + 1
    createMutation.mutate(
      { name: `Edit ${nextNumber}` },
      {
        onSuccess: (newSeq) => {
          resetTimeline()
          setSequence(newSeq as TimelineSequence)
          refetchSequences()
        },
      }
    )
  }, [sequences, createMutation, setSequence, resetTimeline, refetchSequences])

  const handleSwitchSequence = useCallback(
    (seq: TimelineSequence) => {
      if (seq.id === sequence?.id) return
      resetTimeline()
      setSequence(seq)
    },
    [sequence, setSequence, resetTimeline]
  )

  const handleDeleteSequence = useCallback(
    (seqId: string) => {
      if (seqId === sequence?.id) {
        const remaining = (sequences ?? []).filter((s) => s.id !== seqId)
        resetTimeline()
        if (remaining.length > 0) {
          setSequence(remaining[0] as TimelineSequence)
        }
      }
      deleteMutation.mutate(seqId, { onSuccess: () => refetchSequences() })
    },
    [sequence, sequences, deleteMutation, setSequence, resetTimeline, refetchSequences]
  )

  const allSequences = (sequences ?? []) as TimelineSequence[]

  return (
    <div className={cn('timeline-enter', 'relative', className)}>
      <TimelineEditor
        projectId={projectId}
        onOpenLibrary={handleOpenLibrary}
        sequences={allSequences}
        onCreateSequence={handleCreateSequence}
        onSwitchSequence={handleSwitchSequence}
        onDeleteSequence={handleDeleteSequence}
        isCreating={createMutation.isPending}
      />
      {!sequence && (isLoading || createMutation.isPending) && (
        <div className="absolute top-2 right-2 rounded-md border border-border/40 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          Loading timeline…
        </div>
      )}
    </div>
  )
}
