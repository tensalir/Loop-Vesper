'use client'

import { useState, useCallback, useRef } from 'react'
import { FileText, Loader2, ChevronDown, ChevronUp, Plus, Trash2, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePdfBuckets, usePdfBucketImages, type PdfBucketImage } from '@/hooks/usePdfBuckets'
import { usePdfIngestion } from '@/hooks/usePdfIngestion'
import { useToast } from '@/components/ui/use-toast'
import { Dialog, DialogContent } from '@/components/ui/dialog'

export const PDF_BUCKET_MIME = 'application/x-pdf-bucket-image'

interface PdfBucketRailProps {
  projectId: string
  className?: string
}

export function PdfBucketRail({
  projectId,
  className,
}: PdfBucketRailProps) {
  const { toast } = useToast()
  const { buckets, isLoading: bucketsLoading, deleteBucket } = usePdfBuckets(projectId)
  const { ingestPdf, isProcessing, progress, error: ingestionError } = usePdfIngestion(projectId)

  const [activeBucketId, setActiveBucketId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [previewImage, setPreviewImage] = useState<PdfBucketImage | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeBucket = buckets.find((b) => b.id === activeBucketId) ?? buckets[0] ?? null

  const { images: bucketImages, isLoading: imagesLoading } = usePdfBucketImages(
    projectId,
    activeBucket?.id ?? null
  )

  const handleFileUpload = useCallback(
    async (file: File) => {
      const bucketId = await ingestPdf(file)
      if (bucketId) {
        setActiveBucketId(bucketId)
        toast({
          title: 'PDF processed',
          description: `Images extracted from ${file.name}`,
        })
      }
    },
    [ingestPdf, toast]
  )

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handlePreviewImage = useCallback((image: PdfBucketImage) => {
    setPreviewImage(image)
    setPreviewOpen(true)
  }, [])

  const handleDeleteBucket = useCallback(
    async (bucketId: string) => {
      try {
        await deleteBucket.mutateAsync(bucketId)
      } catch {
        // Optimistic removal already happened in the mutation hook
      }
      if (activeBucketId === bucketId) {
        setActiveBucketId(null)
      }
    },
    [deleteBucket, activeBucketId]
  )

  const handleDragStart = useCallback((e: React.DragEvent, image: PdfBucketImage) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(PDF_BUCKET_MIME, image.imageUrl)
    e.dataTransfer.setData('text/uri-list', image.imageUrl)

    const img = new Image()
    img.src = image.imageUrl
    try {
      e.dataTransfer.setDragImage(img, 18, 18)
    } catch {
      // Fallback: browser default drag image
    }
  }, [])

  const hasBuckets = buckets.length > 0
  const showRail = hasBuckets || isProcessing

  if (!showRail && !bucketsLoading) return null

  return (
    <div className={cn(
      'flex flex-col rounded-lg border border-border/40 bg-muted/20 overflow-hidden',
      'transition-all duration-200 ease-out',
      isExpanded ? 'max-h-[200px]' : 'max-h-[28px]',
      className
    )}>
      <div className="flex items-center gap-1.5 px-2 py-1 min-h-[28px]">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <FileText className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">PDF</span>
          {hasBuckets && (
            <span className="text-muted-foreground/60">
              ({activeBucket?._count?.images ?? 0})
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-2.5 w-2.5" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5" />
          )}
        </button>

        {hasBuckets && buckets.length > 1 && isExpanded && (
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {buckets.map((bucket) => (
              <button
                key={bucket.id}
                onClick={() => setActiveBucketId(bucket.id)}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[9px] transition-colors flex-shrink-0 truncate max-w-[64px]',
                  activeBucket?.id === bucket.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground/60 hover:text-muted-foreground'
                )}
              >
                {bucket.fileName.replace(/\.pdf$/i, '')}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-0.5 ml-auto">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:opacity-50"
            title="Upload PDF"
          >
            <Plus className="h-2.5 w-2.5" />
          </button>

          {activeBucket && (
            <button
              onClick={() => handleDeleteBucket(activeBucket.id)}
              className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
              title="Remove this PDF bucket"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {isExpanded && (
        <div className="px-2 pb-1.5">
          {isProcessing && progress && (
            <div className="flex items-center gap-1.5 py-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-primary flex-shrink-0" />
              <span className="text-[9px] text-muted-foreground truncate">
                {progress.message}
              </span>
            </div>
          )}

          {ingestionError && (
            <div className="text-[9px] text-destructive py-0.5">
              {ingestionError}
            </div>
          )}

          {activeBucket && !imagesLoading && bucketImages.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
              {bucketImages.map((image) => (
                <div
                  key={image.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, image)}
                  onClick={() => handlePreviewImage(image)}
                  className={cn(
                    'relative group flex-shrink-0 rounded overflow-hidden cursor-grab active:cursor-grabbing',
                    'w-[32px] h-[32px] border border-border/30 hover:border-border transition-all duration-100',
                    'hover:shadow-sm hover:scale-105'
                  )}
                  title="Drag to reference images, click to preview"
                >
                  <img
                    src={image.imageUrl}
                    alt={image.label || `PDF image ${image.sortOrder + 1}`}
                    className="w-full h-full object-cover pointer-events-none"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center pointer-events-none">
                    <GripVertical className="h-3 w-3 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeBucket && !imagesLoading && bucketImages.length === 0 && activeBucket.status === 'completed' && (
            <div className="text-[9px] text-muted-foreground/50 py-0.5">
              No images found
            </div>
          )}

          {activeBucket && imagesLoading && (
            <div className="flex items-center gap-1 py-0.5">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground/50" />
              <span className="text-[9px] text-muted-foreground/50">Loading...</span>
            </div>
          )}
        </div>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-transparent border-none shadow-none [&>button]:text-white [&>button]:bg-black/50 [&>button]:hover:bg-black/70">
          {previewImage && (
            <div className="flex items-center justify-center">
              <img
                src={previewImage.imageUrl}
                alt={previewImage.label || 'PDF preview'}
                className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
