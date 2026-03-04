'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export interface SnapshotOutput {
  id: string
  fileUrl: string
  generationId: string
  timecodeMs: number | null
  sourceVideoOutputId: string | null
  label: string | null
  createdAt: string
}

async function fetchSnapshots(projectId: string): Promise<SnapshotOutput[]> {
  const res = await fetch(`/api/projects/${projectId}/snapshots`)
  if (!res.ok) return []
  const data = await res.json()
  return data.snapshots ?? []
}

export function useSnapshots(projectId: string | undefined) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['snapshots', projectId],
    queryFn: () => fetchSnapshots(projectId!),
    enabled: !!projectId,
    staleTime: 15_000,
  })

  const deleteSnapshot = useMutation({
    mutationFn: async (generationId: string) => {
      if (!projectId) throw new Error('Missing project ID')
      const res = await fetch(`/api/projects/${projectId}/snapshots/${generationId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete snapshot')
      return generationId
    },
    onMutate: async (generationId) => {
      await queryClient.cancelQueries({ queryKey: ['snapshots', projectId] })
      const previous = queryClient.getQueryData<SnapshotOutput[]>(['snapshots', projectId])
      queryClient.setQueryData<SnapshotOutput[]>(
        ['snapshots', projectId],
        (old) => old?.filter((s) => s.generationId !== generationId) ?? []
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['snapshots', projectId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })
      queryClient.invalidateQueries({ queryKey: ['generations'] })
    },
  })

  return {
    snapshots: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] }),
    deleteSnapshot,
  }
}
