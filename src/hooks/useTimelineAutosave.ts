'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useSaveSequence } from '@/hooks/useTimeline'

const DEBOUNCE_MS = 1_000

interface AutosaveState {
  timer: ReturnType<typeof setTimeout> | null
  inflight: boolean
  queued: boolean
}

/**
 * Debounced single-flight autosave for the timeline editor.
 *
 * - Local state updates remain immediate.
 * - Network save fires after DEBOUNCE_MS of inactivity.
 * - If a save is in-flight when a new dirty tick arrives, the latest
 *   state is queued and sent once the current save completes.
 * - Exposes `flushNow()` for destructive boundaries (sequence switch,
 *   export enqueue, mode change, page unload).
 */
export function useTimelineAutosave(projectId: string, { autoSchedule = true }: { autoSchedule?: boolean } = {}) {
  const sequence = useTimelineStore((s) => s.sequence)
  const isDirty = useTimelineStore((s) => s.isDirty)
  const saveMutation = useSaveSequence(projectId, sequence?.id ?? '')
  const stateRef = useRef<AutosaveState>({ timer: null, inflight: false, queued: false })
  const mutateAsyncRef = useRef(saveMutation.mutateAsync)

  useEffect(() => {
    mutateAsyncRef.current = saveMutation.mutateAsync
  }, [saveMutation.mutateAsync])

  const doSave = useCallback(async () => {
    const seq = useTimelineStore.getState().sequence
    if (!seq || !seq.id) return

    const st = stateRef.current
    if (st.inflight) {
      st.queued = true
      return
    }

    st.inflight = true
    try {
      const saved = await mutateAsyncRef.current({
        name: seq.name,
        durationMs: seq.durationMs,
        tracks: seq.tracks,
        transitions: seq.transitions,
      })

      const store = useTimelineStore.getState()
      if (saved && saved.id !== seq.id) {
        store.setSequence({ ...seq, ...saved, tracks: seq.tracks })
      }
      store.markClean()
    } catch {
      // mutation already handles toast / error; keep dirty so next tick retries
    } finally {
      st.inflight = false
      if (st.queued) {
        st.queued = false
        void doSave()
      }
    }
  }, [])

  const scheduleSave = useCallback(() => {
    const st = stateRef.current
    if (st.timer) clearTimeout(st.timer)
    st.timer = setTimeout(() => {
      st.timer = null
      void doSave()
    }, DEBOUNCE_MS)
  }, [doSave])

  const flushNow = useCallback(async () => {
    const st = stateRef.current
    if (st.timer) {
      clearTimeout(st.timer)
      st.timer = null
    }
    if (useTimelineStore.getState().isDirty) {
      await doSave()
    }
  }, [doSave])

  useEffect(() => {
    if (autoSchedule && isDirty) scheduleSave()
  }, [autoSchedule, isDirty, scheduleSave])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') void flushNow()
    }
    const handleBeforeUnload = () => void flushNow()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    const st = stateRef.current
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (st.timer) clearTimeout(st.timer)
    }
  }, [flushNow])

  return { flushNow, isSaving: saveMutation.isPending }
}
