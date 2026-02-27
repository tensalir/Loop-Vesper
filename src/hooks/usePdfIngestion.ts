'use client'

import { useState, useCallback } from 'react'
import { extractImagesFromPdf, type ExtractionProgress } from '@/lib/pdf-extraction'
import { isSegmentationEnabled, segmentRenderedImages } from '@/lib/pdf-segmentation'
import { usePdfBuckets, usePdfBucketImages } from '@/hooks/usePdfBuckets'

interface PdfIngestionState {
  isProcessing: boolean
  progress: ExtractionProgress | null
  error: string | null
}

/**
 * Orchestrates the full PDF ingestion flow:
 * 1. Create a bucket record
 * 2. Extract images client-side
 * 3. Upload extracted images to server
 * 4. Mark bucket as completed
 */
export function usePdfIngestion(projectId: string) {
  const [state, setState] = useState<PdfIngestionState>({
    isProcessing: false,
    progress: null,
    error: null,
  })

  const { createBucket, updateBucket, refetch: refetchBuckets } = usePdfBuckets(projectId)
  const { uploadImages } = usePdfBucketImages(projectId, null)

  const ingestPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setState({ isProcessing: false, progress: null, error: 'Not a PDF file' })
      return null
    }

    setState({ isProcessing: true, progress: null, error: null })

    let bucketId: string | null = null

    try {
      // 1. Create bucket record
      console.log('[pdf-ingestion] Creating bucket for:', file.name)
      const bucket = await createBucket.mutateAsync({
        fileName: file.name,
      })
      bucketId = bucket.id
      console.log('[pdf-ingestion] Bucket created:', bucket.id)

      // 2. Extract images client-side
      console.log('[pdf-ingestion] Starting client-side extraction...')
      const { images, pageCount } = await extractImagesFromPdf(file, (progress) => {
        setState((prev) => ({ ...prev, progress }))
      })
      console.log(`[pdf-ingestion] Extraction done: ${images.length} images from ${pageCount} pages`)

      let finalImages = images
      const segmentationEnabled = isSegmentationEnabled()
      const renderedImages = images.filter((img) => img.source === 'rendered')
      const embeddedImages = images.filter((img) => img.source === 'embedded')

      if (segmentationEnabled && renderedImages.length > 0) {
        const segmentedImages = await segmentRenderedImages(
          renderedImages.map((img) => ({
            blob: img.blob,
            file: img.file,
            width: img.width,
            height: img.height,
            pageIndex: img.pageIndex,
            source: 'rendered' as const,
          })),
          projectId
        )
        finalImages = [...embeddedImages, ...segmentedImages]
      }

      if (finalImages.length === 0) {
        await updateBucket.mutateAsync({
          bucketId: bucket.id,
          status: 'completed',
          pageCount,
          error: 'No reference images detected in PDF',
        })
        await refetchBuckets()
        setState({
          isProcessing: false,
          progress: null,
          error: 'No reference images detected in the PDF',
        })
        return bucket.id
      }

      // 3. Upload images in batches
      console.log(`[pdf-ingestion] Uploading ${finalImages.length} images...`)
      const BATCH_SIZE = 5
      for (let i = 0; i < finalImages.length; i += BATCH_SIZE) {
        const batch = finalImages.slice(i, i + BATCH_SIZE)

        setState((prev) => ({
          ...prev,
          progress: {
            phase: 'extracting' as const,
            currentPage: 0,
            totalPages: 0,
            imagesFound: finalImages.length,
            message: `Uploading images... (${Math.min(i + BATCH_SIZE, finalImages.length)}/${finalImages.length})`,
          },
        }))

        await uploadImages(
          bucket.id,
          batch.map((img) => ({
            file: img.file,
            pageIndex: img.pageIndex,
            source: img.source,
          }))
        )
        console.log(`[pdf-ingestion] Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1}`)
      }

      // 4. Mark bucket as completed
      await updateBucket.mutateAsync({
        bucketId: bucket.id,
        status: 'completed',
        pageCount,
      })
      console.log('[pdf-ingestion] Bucket marked completed')

      await refetchBuckets()

      setState({ isProcessing: false, progress: null, error: null })
      return bucket.id
    } catch (err: any) {
      const errorMsg = err?.message || 'PDF processing failed'
      console.error('[pdf-ingestion] Error:', errorMsg, err)

      // Try to mark the bucket as failed so it doesn't stay stuck in "processing"
      if (bucketId) {
        try {
          await updateBucket.mutateAsync({
            bucketId,
            status: 'failed',
            error: errorMsg,
          })
          await refetchBuckets()
        } catch (updateErr) {
          console.error('[pdf-ingestion] Failed to mark bucket as failed:', updateErr)
        }
      }

      setState({ isProcessing: false, progress: null, error: errorMsg })
      return null
    }
  }, [projectId, createBucket, updateBucket, uploadImages, refetchBuckets])

  return {
    ingestPdf,
    isProcessing: state.isProcessing,
    progress: state.progress,
    error: state.error,
    clearError: () => setState((prev) => ({ ...prev, error: null })),
  }
}
