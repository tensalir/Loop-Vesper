'use client'

import { useEffect } from 'react'
import { X, Download, Bookmark, RotateCcw, Check, Video, Pin } from 'lucide-react'
import type { Output } from '@/types/generation'

interface ImageLightboxProps {
  imageUrl: string
  output: Output | null
  isOpen: boolean
  onClose: () => void
  onBookmark: (outputId: string, isBookmarked: boolean) => void
  onApprove: (outputId: string, isApproved: boolean) => void
  onReuse: () => void
  onDownload: (imageUrl: string, outputId: string, fileType: string) => void
  /** Optional: open the Animate Still flow for this image */
  onConvertToVideo?: () => void
  /** Optional: pin image to project for reuse as reference */
  onPin?: (imageUrl: string) => void
}

export function ImageLightbox({ 
  imageUrl, 
  output,
  isOpen, 
  onClose,
  onBookmark,
  onApprove,
  onReuse,
  onDownload,
  onConvertToVideo,
  onPin,
}: ImageLightboxProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen || !output) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors z-10"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Image and Action Bar Container */}
      <div 
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image */}
        <img
          src={imageUrl}
          alt="Full size preview"
          className="max-w-full max-h-[calc(90vh-80px)] object-contain rounded-lg shadow-2xl"
        />

        {/* Action Bar */}
        <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md rounded-full px-6 py-3 border border-white/20">
          <button
            onClick={() => onDownload(imageUrl, output.id, output.fileType)}
            className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
            title="Download"
          >
            <Download className="h-5 w-5 text-white" />
          </button>
          {onPin && (
            <button
              onClick={() => onPin(imageUrl)}
              className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
              title="Pin to project"
            >
              <Pin className="h-5 w-5 text-white" />
            </button>
          )}
          {onConvertToVideo && (
            <button
              onClick={onConvertToVideo}
              className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
              title="Animate still"
            >
              <Video className="h-5 w-5 text-white" />
            </button>
          )}
          <button
            onClick={onReuse}
            className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
            title="Reuse parameters"
          >
            <RotateCcw className="h-5 w-5 text-white" />
          </button>
          <button
            onClick={() => onBookmark(output.id, (output as any).isBookmarked || false)}
            className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
            title={(output as any).isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          >
            <Bookmark className={`h-5 w-5 text-white ${(output as any).isBookmarked ? 'fill-white' : ''}`} />
          </button>
          <button
            onClick={() => onApprove(output.id, (output as any).isApproved || false)}
            className={`p-2 rounded-lg transition-colors ${
              (output as any).isApproved
                ? 'bg-green-500/90 hover:bg-green-600/90'
                : 'bg-white/20 hover:bg-white/30'
            }`}
            title={(output as any).isApproved ? 'Approved for review' : 'Approve for review'}
          >
            <Check className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}

