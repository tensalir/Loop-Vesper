'use client'

import Image from 'next/image'
import { X, User, Copy, Check } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { CommunityCreation } from '@/hooks/useCommunityCreations'

interface CommunityCreationDialogProps {
  creation: CommunityCreation | null
  open: boolean
  onClose: () => void
}

// Format model name for display
const formatModelName = (modelId: string): string => {
  return modelId
    .replace('gemini-', '')
    .replace('fal-', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Get reference image URL from parameters
const getReferenceImageUrl = (parameters: Record<string, any>): string | null => {
  // Direct URL
  if (parameters?.referenceImageUrl) {
    return parameters.referenceImageUrl
  }
  
  // Check referenceImages array
  if (parameters?.referenceImages?.length > 0) {
    const firstRef = parameters.referenceImages[0]
    if (typeof firstRef === 'string') return firstRef
    if (firstRef?.url) return firstRef.url
  }
  
  return null
}

// Format date
const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  })
}

export function CommunityCreationDialog({
  creation,
  open,
  onClose,
}: CommunityCreationDialogProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (open) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [open, onClose])

  if (!open || !creation) return null

  const { generation, fileUrl, fileType } = creation
  const { prompt, modelId, parameters, user, createdAt } = generation
  const referenceImageUrl = getReferenceImageUrl(parameters)

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors z-10"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Content Container - Side by side layout */}
      <div 
        className="flex flex-col md:flex-row items-stretch gap-6 max-w-6xl w-full max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Prompt Card - matching session styling */}
        <div className="w-full md:w-96 flex-shrink-0 bg-card rounded-xl p-6 border border-border flex flex-col" style={{ minHeight: '320px' }}>
          {/* Prompt */}
          <div className="flex-1 overflow-hidden hover:overflow-y-auto transition-all group relative" style={{ maxHeight: '200px' }}>
            <p 
              className="text-base font-normal leading-relaxed text-foreground/90 cursor-pointer hover:text-primary transition-colors"
              onClick={handleCopyPrompt}
              title="Click to copy"
            >
              {prompt}
            </p>
            {copied ? (
              <Check className="h-3.5 w-3.5 absolute top-0 right-0 text-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5 absolute top-0 right-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-2 text-xs text-muted-foreground mt-4">
            {/* User */}
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                {user.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt={user.displayName || 'User'}
                    width={20}
                    height={20}
                    className="rounded-full"
                  />
                ) : (
                  <User className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
              <span className="font-medium">
                {user.displayName || user.username || 'Anonymous'}
              </span>
            </div>

            {/* Model */}
            <div className="flex items-center gap-2">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className="h-3.5 w-3.5 text-primary"
              >
                <path d="M15 4V2" />
                <path d="M15 16v-2" />
                <path d="M8 9h2" />
                <path d="M20 9h2" />
                <path d="M17.8 11.8 19 13" />
                <path d="M15 9h0" />
                <path d="M17.8 6.2 19 5" />
                <path d="m3 21 9-9" />
                <path d="M12.2 6.2 11 5" />
              </svg>
              <span className="font-medium">{formatModelName(modelId)}</span>
            </div>

            {/* Date */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">Generated:</span>
              <span className="font-medium">{formatDate(createdAt)}</span>
            </div>

            {/* Reference Image */}
            {referenceImageUrl && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="text-xs text-muted-foreground/70 mb-1.5">Reference Image:</div>
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-border/50">
                  <img 
                    src={referenceImageUrl} 
                    alt="Reference" 
                    className="w-full h-full object-cover" 
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Media */}
        <div className="flex-1 flex items-center justify-center min-h-[300px] md:min-h-0">
          <div className="relative w-full h-full flex items-center justify-center">
            {fileType === 'video' ? (
              <video
                src={fileUrl}
                className="max-w-full max-h-[70vh] md:max-h-[80vh] object-contain rounded-lg shadow-2xl"
                controls
                autoPlay
                muted
                loop
              />
            ) : (
              <img
                src={fileUrl}
                alt={prompt.slice(0, 100)}
                className="max-w-full max-h-[70vh] md:max-h-[80vh] object-contain rounded-lg shadow-2xl"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
