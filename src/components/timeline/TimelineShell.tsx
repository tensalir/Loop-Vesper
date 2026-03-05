'use client'

import { useEffect, useCallback, useRef, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { useTimelineSequences, useCreateSequence, useDeleteSequence, useRenameSequence } from '@/hooks/useTimeline'
import { useTimelineAutosave } from '@/hooks/useTimelineAutosave'
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
  onSnapshotRequest?: (req: {
    blob: Blob; timelineMs: number; timecodeMs: number; clipId: string; trackId: string;
    isAtClipEnd: boolean; fileUrl: string; outputId: string | null;
  }) => void
  isPromptMode?: boolean
  timelinePromptSlot?: ReactNode
}

export function TimelineShell({
  projectId,
  className,
  onSnapshotRequest,
  isPromptMode = false,
  timelinePromptSlot,
}: TimelineShellProps) {
  const { sequence, setSequence, setLibraryOpen, setLibraryInsertTarget, finishModeSwitch, resetTimeline } = useTimelineStore()
  const { data: sequences, isLoading, refetch: refetchSequences } = useTimelineSequences(projectId)
  const createMutation = useCreateSequence(projectId)
  const deleteMutation = useDeleteSequence(projectId)
  const renameMutation = useRenameSequence(projectId)
  const { flushNow, isSaving } = useTimelineAutosave(projectId)
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
    setLibraryInsertTarget(null)
    setLibraryOpen(true)
    ensureSequence(undefined, true)
  }, [ensureSequence, setLibraryOpen, setLibraryInsertTarget])

  const handleInsertFromLibrary = useCallback((trackId: string, afterMs: number) => {
    setLibraryInsertTarget({ trackId, timelineMs: afterMs })
    setLibraryOpen(true)
  }, [setLibraryInsertTarget, setLibraryOpen])

  const handleCreateSequence = useCallback(async () => {
    await flushNow()
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
  }, [sequences, createMutation, setSequence, resetTimeline, refetchSequences, flushNow])

  const handleSwitchSequence = useCallback(
    async (seq: TimelineSequence) => {
      if (seq.id === sequence?.id) return
      await flushNow()
      resetTimeline()
      setSequence(seq)
    },
    [sequence, setSequence, resetTimeline, flushNow]
  )

  const handleRenameSequence = useCallback(
    async (seqId: string, newName: string) => {
      renameMutation.mutate(
        { sequenceId: seqId, name: newName },
        {
          onSuccess: (updated) => {
            if (sequence?.id === seqId) {
              setSequence({ ...sequence, name: updated.name } as TimelineSequence)
            }
            refetchSequences()
          },
        }
      )
    },
    [sequence, setSequence, renameMutation, refetchSequences]
  )

  const handleDeleteSequence = useCallback(
    async (seqId: string) => {
      await flushNow()
      if (seqId === sequence?.id) {
        const remaining = (sequences ?? []).filter((s) => s.id !== seqId)
        resetTimeline()
        if (remaining.length > 0) {
          setSequence(remaining[0] as TimelineSequence)
        }
      }
      deleteMutation.mutate(seqId, { onSuccess: () => refetchSequences() })
    },
    [sequence, sequences, deleteMutation, setSequence, resetTimeline, refetchSequences, flushNow]
  )

  const allSequences = (sequences ?? []) as TimelineSequence[]

  return (
    <div className={cn('timeline-enter', 'relative', className)}>
      <TimelineEditor
        projectId={projectId}
        onOpenLibrary={handleOpenLibrary}
        onInsertFromLibrary={handleInsertFromLibrary}
        sequences={allSequences}
        onCreateSequence={handleCreateSequence}
        onSwitchSequence={handleSwitchSequence}
        onRenameSequence={handleRenameSequence}
        onDeleteSequence={handleDeleteSequence}
        isCreating={createMutation.isPending}
        onSnapshotRequest={onSnapshotRequest}
        flushNow={flushNow}
        isSaving={isSaving}
        isPromptMode={isPromptMode}
        timelinePromptSlot={timelinePromptSlot}
      />
      {!sequence && (isLoading || createMutation.isPending) && (
        <div className="absolute top-2 right-2 rounded-md border border-border/40 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          Loading timeline…
        </div>
      )}
    </div>
  )
}
