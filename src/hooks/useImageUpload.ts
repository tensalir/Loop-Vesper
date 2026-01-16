'use client'

import { useState, useCallback } from 'react'

export interface UploadedImage {
  url: string
  path: string
  bucket: string
  size: number
  mimeType: string
  /** Local preview URL (blob URL) for immediate display */
  previewUrl: string
  /** Original file reference */
  file: File
}

export interface UseImageUploadOptions {
  /** Purpose of the upload - affects storage path */
  purpose?: 'reference' | 'endframe'
  /** Optional: compress images before upload (default: true for images > 5MB) */
  compress?: boolean
  /** Max dimension for compression (default: 2048) */
  maxDimension?: number
  /** JPEG quality for compression (default: 0.9) */
  quality?: number
}

export interface UseImageUploadReturn {
  /** Upload a file to storage */
  upload: (file: File) => Promise<UploadedImage>
  /** Upload multiple files to storage */
  uploadMultiple: (files: File[]) => Promise<UploadedImage[]>
  /** Whether an upload is in progress */
  isUploading: boolean
  /** Upload progress (0-100) */
  progress: number
  /** Error message if upload failed */
  error: string | null
  /** Clear error */
  clearError: () => void
}

/**
 * Hook for uploading images to Supabase Storage via the API endpoint.
 * 
 * This bypasses Vercel's 4.5MB body limit by using multipart form data
 * and streaming uploads directly to storage.
 */
export function useImageUpload(options: UseImageUploadOptions = {}): UseImageUploadReturn {
  const {
    purpose = 'reference',
    compress = true,
    maxDimension = 2048,
    quality = 0.9,
  } = options

  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  /**
   * Optionally compress an image before upload
   */
  const maybeCompress = useCallback(async (file: File): Promise<File> => {
    // Skip compression for small files or if disabled
    const COMPRESSION_THRESHOLD = 5 * 1024 * 1024 // 5MB
    if (!compress || file.size < COMPRESSION_THRESHOLD) {
      return file
    }

    // Skip non-image files
    if (!file.type.startsWith('image/')) {
      return file
    }

    return new Promise((resolve) => {
      const img = new Image()
      const canvas = document.createElement('canvas')
      
      img.onload = () => {
        let { width, height } = img
        
        // Only resize if larger than max dimension
        if (width > maxDimension || height > maxDimension) {
          const ratio = maxDimension / Math.max(width, height)
          width = Math.floor(width * ratio)
          height = Math.floor(height * ratio)
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file) // Fallback to original
          return
        }
        
        ctx.drawImage(img, 0, 0, width, height)
        
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              // Only use compressed version if it's actually smaller
              resolve(new File([blob], file.name, { type: 'image/jpeg' }))
            } else {
              resolve(file)
            }
          },
          'image/jpeg',
          quality
        )
      }
      
      img.onerror = () => resolve(file) // Fallback to original
      img.src = URL.createObjectURL(file)
    })
  }, [compress, maxDimension, quality])

  /**
   * Upload a single file
   */
  const upload = useCallback(async (file: File): Promise<UploadedImage> => {
    setIsUploading(true)
    setProgress(0)
    setError(null)

    try {
      // Create local preview immediately
      const previewUrl = URL.createObjectURL(file)
      
      // Optionally compress
      setProgress(10)
      const processedFile = await maybeCompress(file)
      setProgress(20)

      // Upload via API
      const formData = new FormData()
      formData.append('file', processedFile)
      formData.append('purpose', purpose)

      const response = await fetch('/api/upload/reference-image', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })

      setProgress(90)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Upload failed: ${response.status}`)
      }

      const data = await response.json()
      setProgress(100)

      return {
        url: data.url,
        path: data.path,
        bucket: data.bucket,
        size: data.size,
        mimeType: data.mimeType,
        previewUrl,
        file,
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Upload failed'
      setError(errorMessage)
      throw new Error(errorMessage)
    } finally {
      setIsUploading(false)
    }
  }, [purpose, maybeCompress])

  /**
   * Upload multiple files in parallel
   */
  const uploadMultiple = useCallback(async (files: File[]): Promise<UploadedImage[]> => {
    setIsUploading(true)
    setProgress(0)
    setError(null)

    try {
      const results: UploadedImage[] = []
      const total = files.length

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const previewUrl = URL.createObjectURL(file)
        const processedFile = await maybeCompress(file)

        const formData = new FormData()
        formData.append('file', processedFile)
        formData.append('purpose', purpose)

        const response = await fetch('/api/upload/reference-image', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Upload failed: ${response.status}`)
        }

        const data = await response.json()
        results.push({
          url: data.url,
          path: data.path,
          bucket: data.bucket,
          size: data.size,
          mimeType: data.mimeType,
          previewUrl,
          file,
        })

        setProgress(Math.round(((i + 1) / total) * 100))
      }

      return results
    } catch (err: any) {
      const errorMessage = err.message || 'Upload failed'
      setError(errorMessage)
      throw new Error(errorMessage)
    } finally {
      setIsUploading(false)
    }
  }, [purpose, maybeCompress])

  return {
    upload,
    uploadMultiple,
    isUploading,
    progress,
    error,
    clearError,
  }
}
