'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export interface PdfBucket {
  id: string
  projectId: string
  userId: string
  fileName: string
  storagePath: string | null
  status: 'processing' | 'completed' | 'failed'
  pageCount: number | null
  error: string | null
  createdAt: string
  updatedAt: string
  _count: { images: number }
}

export interface PdfBucketImage {
  id: string
  bucketId: string
  imageUrl: string
  storagePath: string
  width: number | null
  height: number | null
  pageIndex: number | null
  sortOrder: number
  label: string | null
  source: 'embedded' | 'rendered' | 'segmented'
  createdAt: string
}

export function usePdfBuckets(projectId: string) {
  const queryClient = useQueryClient()

  const bucketsQuery = useQuery({
    queryKey: ['pdf-buckets', projectId],
    queryFn: async (): Promise<PdfBucket[]> => {
      const res = await fetch(`/api/projects/${projectId}/pdf-buckets`)
      if (!res.ok) throw new Error('Failed to fetch PDF buckets')
      const data = await res.json()
      return data.buckets
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })

  const createBucket = useMutation({
    mutationFn: async (args: { fileName: string; storagePath?: string; pageCount?: number }) => {
      const res = await fetch(`/api/projects/${projectId}/pdf-buckets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      })
      if (!res.ok) throw new Error('Failed to create PDF bucket')
      const data = await res.json()
      return data.bucket as PdfBucket
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-buckets', projectId] })
    },
  })

  const updateBucket = useMutation({
    mutationFn: async (args: { bucketId: string; status?: string; pageCount?: number; error?: string | null }) => {
      const { bucketId, ...body } = args
      const res = await fetch(`/api/projects/${projectId}/pdf-buckets/${bucketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to update PDF bucket')
      const data = await res.json()
      return data.bucket as PdfBucket
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-buckets', projectId] })
    },
  })

  const deleteBucket = useMutation({
    mutationFn: async (bucketId: string) => {
      const res = await fetch(`/api/projects/${projectId}/pdf-buckets/${bucketId}`, {
        method: 'DELETE',
      })
      // 404 = already gone, treat as success
      if (!res.ok && res.status !== 404) {
        throw new Error('Failed to delete PDF bucket')
      }
      return bucketId
    },
    onMutate: async (bucketId) => {
      await queryClient.cancelQueries({ queryKey: ['pdf-buckets', projectId] })
      const previous = queryClient.getQueryData<PdfBucket[]>(['pdf-buckets', projectId])
      queryClient.setQueryData<PdfBucket[]>(
        ['pdf-buckets', projectId],
        (old) => old?.filter((b) => b.id !== bucketId) ?? []
      )
      return { previous }
    },
    onError: (_err, _bucketId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['pdf-buckets', projectId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-buckets', projectId] })
    },
  })

  return {
    buckets: bucketsQuery.data ?? [],
    isLoading: bucketsQuery.isLoading,
    createBucket,
    updateBucket,
    deleteBucket,
    refetch: bucketsQuery.refetch,
  }
}

export function usePdfBucketImages(projectId: string, bucketId: string | null) {
  const queryClient = useQueryClient()

  const imagesQuery = useQuery({
    queryKey: ['pdf-bucket-images', bucketId],
    queryFn: async (): Promise<PdfBucketImage[]> => {
      const res = await fetch(`/api/projects/${projectId}/pdf-buckets/${bucketId}/images`)
      if (!res.ok) throw new Error('Failed to fetch bucket images')
      const data = await res.json()
      return data.images
    },
    enabled: !!projectId && !!bucketId,
    staleTime: 30_000,
  })

  const uploadImages = useCallback(async (
    targetBucketId: string,
    images: Array<{ file: File; pageIndex?: number; source?: string }>
  ) => {
    const formData = new FormData()
    images.forEach(({ file, pageIndex, source }) => {
      formData.append('images', file)
      formData.append('pageIndices', pageIndex?.toString() ?? '')
      formData.append('sources', source ?? 'embedded')
    })

    const res = await fetch(
      `/api/projects/${projectId}/pdf-buckets/${targetBucketId}/images`,
      { method: 'POST', body: formData }
    )
    if (!res.ok) throw new Error('Failed to upload images')
    const data = await res.json()

    queryClient.invalidateQueries({ queryKey: ['pdf-bucket-images', targetBucketId] })
    queryClient.invalidateQueries({ queryKey: ['pdf-buckets', projectId] })

    return data.images as PdfBucketImage[]
  }, [projectId, queryClient])

  return {
    images: imagesQuery.data ?? [],
    isLoading: imagesQuery.isLoading,
    uploadImages,
    refetch: imagesQuery.refetch,
  }
}
