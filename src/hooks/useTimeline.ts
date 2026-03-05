'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimelineSequence } from '@/types/timeline'

interface SequenceApiResponse {
  sequence: TimelineSequence
}

interface SequenceListResponse {
  sequences: TimelineSequence[]
}

async function fetchSequences(projectId: string): Promise<TimelineSequence[]> {
  const res = await fetch(`/api/projects/${projectId}/timeline`)
  if (!res.ok) throw new Error('Failed to fetch timelines')
  const data: SequenceListResponse = await res.json()
  return data.sequences
}

async function fetchSequence(projectId: string, sequenceId: string): Promise<TimelineSequence> {
  const res = await fetch(`/api/projects/${projectId}/timeline/${sequenceId}`)
  if (!res.ok) throw new Error('Failed to load timeline')
  const data: SequenceApiResponse = await res.json()
  return data.sequence
}

async function createSequence(projectId: string, name?: string, sessionId?: string): Promise<TimelineSequence> {
  const res = await fetch(`/api/projects/${projectId}/timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sessionId }),
  })
  if (!res.ok) throw new Error('Failed to create timeline')
  const data: SequenceApiResponse = await res.json()
  return data.sequence
}

async function saveSequence(
  projectId: string,
  sequenceId: string,
  payload: { name?: string; durationMs?: number; tracks?: any[]; transitions?: any[] }
): Promise<TimelineSequence> {
  const isLocal = sequenceId.startsWith('local-')

  if (isLocal) {
    const createRes = await fetch(`/api/projects/${projectId}/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: payload.name || 'Sequence 1' }),
    })
    if (!createRes.ok) throw new Error('Failed to create timeline on server')
    const created: SequenceApiResponse = await createRes.json()
    sequenceId = created.sequence.id
  }

  const res = await fetch(`/api/projects/${projectId}/timeline/${sequenceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to save timeline')
  }
  const data: SequenceApiResponse = await res.json()
  return data.sequence
}

async function deleteSequence(projectId: string, sequenceId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/timeline/${sequenceId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete timeline')
}

async function enqueueRender(projectId: string, sequenceId: string, resolution?: number) {
  const res = await fetch(`/api/projects/${projectId}/timeline/${sequenceId}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to enqueue render')
  }
  return res.json()
}

async function fetchRenderJobs(projectId: string, sequenceId: string) {
  const res = await fetch(`/api/projects/${projectId}/timeline/${sequenceId}/render`)
  if (!res.ok) throw new Error('Failed to fetch render jobs')
  return res.json()
}

export function useTimelineSequences(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['timeline-sequences', projectId],
    queryFn: () => fetchSequences(projectId!),
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  })
}

export function useTimelineSequence(projectId: string | undefined, sequenceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['timeline-sequence', projectId, sequenceId],
    queryFn: () => fetchSequence(projectId!, sequenceId!),
    enabled: !!projectId && !!sequenceId && enabled,
    staleTime: 10_000,
  })
}

export function useCreateSequence(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, sessionId }: { name?: string; sessionId?: string }) =>
      createSequence(projectId, name, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-sequences', projectId] })
    },
  })
}

export function useSaveSequence(projectId: string, sequenceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { name?: string; durationMs?: number; tracks?: any[]; transitions?: any[] }) =>
      saveSequence(projectId, sequenceId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['timeline-sequence', projectId, sequenceId], data)
      queryClient.invalidateQueries({ queryKey: ['timeline-sequences', projectId] })
    },
  })
}

export function useRenameSequence(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ sequenceId, name }: { sequenceId: string; name: string }) => {
      const res = await fetch(`/api/projects/${projectId}/timeline/${sequenceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('Failed to rename timeline')
      const data: SequenceApiResponse = await res.json()
      return data.sequence
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-sequences', projectId] })
    },
  })
}

export function useDeleteSequence(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sequenceId: string) => deleteSequence(projectId, sequenceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-sequences', projectId] })
    },
  })
}

export function useEnqueueRender(projectId: string, sequenceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (resolution?: number) => enqueueRender(projectId, sequenceId, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-render-jobs', projectId, sequenceId] })
    },
  })
}

export function useRenderJobs(projectId: string | undefined, sequenceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['timeline-render-jobs', projectId, sequenceId],
    queryFn: () => fetchRenderJobs(projectId!, sequenceId!),
    enabled: !!projectId && !!sequenceId && enabled,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.renderJobs?.some((j: any) => j.status === 'queued' || j.status === 'processing')) {
        return 3000
      }
      return false
    },
  })
}
