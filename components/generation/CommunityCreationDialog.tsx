'use client'

import Image from 'next/image'
import { X, User, Wand2, Settings2, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

// Format parameter value for display
const formatParamValue = (key: string, value: any): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

// Filter parameters to show only relevant ones
const getDisplayParams = (params: Record<string, any>): [string, any][] => {
  const excludeKeys = [
    'referenceImageUrl',
    'referenceImages',
    'referenceImagePath',
    'referenceImageBucket',
    'referenceImageId',
    'referenceImageMimeType',
    'error',
  ]
  
  const displayKeys = [
    'aspectRatio',
    'numOutputs',
    'seed',
    'guidanceScale',
    'numInferenceSteps',
    'style',
    'negativePrompt',
  ]

  return Object.entries(params)
    .filter(([key]) => !excludeKeys.includes(key))
    .filter(([key, value]) => displayKeys.includes(key) && value !== null && value !== undefined)
    .slice(0, 6) // Limit to 6 parameters
}

export function CommunityCreationDialog({
  creation,
  open,
  onClose,
}: CommunityCreationDialogProps) {
  const [copied, setCopied] = useState(false)

  if (!creation) return null

  const { generation, fileUrl, fileType } = creation
  const { prompt, modelId, parameters, user } = generation
  const displayParams = getDisplayParams(parameters)
  const aspectRatio = (parameters?.aspectRatio as string) || '1:1'

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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden bg-card border-border">
        <div className="flex flex-col md:flex-row">
          {/* Left: Media preview */}
          <div className="relative w-full md:w-1/2 aspect-square bg-muted flex-shrink-0">
            {fileType === 'video' ? (
              <video
                src={fileUrl}
                className="w-full h-full object-cover"
                controls
                autoPlay
                muted
                loop
              />
            ) : (
              <Image
                src={fileUrl}
                alt={prompt.slice(0, 100)}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            )}
          </div>

          {/* Right: Details */}
          <div className="flex flex-col p-6 w-full md:w-1/2">
            {/* Header with close button */}
            <DialogHeader className="pb-4 border-b border-border">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-semibold">
                  Creation Details
                </DialogTitle>
              </div>
            </DialogHeader>

            {/* Creator info */}
            <div className="flex items-center gap-2 py-4 border-b border-border">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                {user.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt={user.displayName || 'User'}
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                ) : (
                  <User className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <span className="font-medium text-sm">
                {user.displayName || user.username || 'Anonymous'}
              </span>
            </div>

            {/* Prompt */}
            <div className="py-4 border-b border-border flex-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Prompt
                </h3>
                <button
                  onClick={handleCopyPrompt}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                  title="Copy prompt"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <p className="text-sm leading-relaxed text-foreground/90 max-h-32 overflow-y-auto">
                {prompt}
              </p>
            </div>

            {/* Model & Settings */}
            <div className="pt-4 space-y-3">
              {/* Model */}
              <div className="flex items-center gap-2">
                <Wand2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Model:</span>
                <span className="text-xs font-medium">
                  {formatModelName(modelId)}
                </span>
              </div>

              {/* Settings */}
              {displayParams.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Settings</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-5">
                    {displayParams.map(([key, value]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}:
                        </span>
                        <span className="font-medium">
                          {formatParamValue(key, value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
