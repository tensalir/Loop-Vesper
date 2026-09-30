'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ImagePlus, Film, Music, Plus, X, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { useMediaUpload, type MediaKind, type UploadedMedia } from '@/hooks/useMediaUpload'
import { toViewUrl } from '@/lib/storage/refs'

/** One uploaded reference, already in storage and addressable by the provider. */
export interface ReferenceSetItem {
  id: string
  kind: MediaKind
  url: string
  previewUrl: string
  name: string
  durationSeconds: number | null
}

export interface ReferenceSetLimits {
  maxImages: number
  maxVideos: number
  maxAudios: number
  /** Combined duration ceiling applied to videos and to audios separately. */
  maxMediaSeconds: number
}

interface ReferenceSetPickerProps {
  items: ReferenceSetItem[]
  onItemsChange: (items: ReferenceSetItem[]) => void
  limits: ReferenceSetLimits
  disabled?: boolean
  /**
   * True when a start or end frame is currently set. Seedance cannot combine
   * frames with reference sets, so we warn instead of letting the provider
   * reject the job.
   */
  framesInUse?: boolean
  /** Called when the user confirms they want reference sets instead of frames. */
  onClearFrames?: () => void
  /** Reports upload activity so the parent can block Generate mid-upload. */
  onUploadingChange?: (isUploading: boolean) => void
}

const ACCEPT_BY_KIND: Record<MediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function totalDuration(items: ReferenceSetItem[], kind: MediaKind): number {
  return items
    .filter((item) => item.kind === kind)
    .reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0)
}

/**
 * Picker for Seedance 2.5's multimodal reference sets.
 *
 * These are NOT start/end frames — they guide character consistency, style,
 * motion and audio, and the API refuses to accept them alongside
 * `image`/`last_frame_image`. The caller is responsible for making that
 * exclusivity visible; this component surfaces it and offers the swap.
 */
export function ReferenceSetPicker({
  items,
  onItemsChange,
  limits,
  disabled = false,
  framesInUse = false,
  onClearFrames,
  onUploadingChange,
}: ReferenceSetPickerProps) {
  const { toast } = useToast()
  const mediaUpload = useMediaUpload({ purpose: 'reference-set' })
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [pendingKind, setPendingKind] = useState<MediaKind>('image')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onUploadingChange?.(mediaUpload.isUploading)
  }, [mediaUpload.isUploading, onUploadingChange])

  const counts = {
    image: items.filter((i) => i.kind === 'image').length,
    video: items.filter((i) => i.kind === 'video').length,
    audio: items.filter((i) => i.kind === 'audio').length,
  }

  const capFor = (kind: MediaKind) =>
    kind === 'image' ? limits.maxImages : kind === 'video' ? limits.maxVideos : limits.maxAudios

  // Audio only makes sense next to a visual reference; the API rejects it alone.
  const hasVisualReference = counts.image > 0 || counts.video > 0

  const openPickerFor = (kind: MediaKind) => {
    if (counts[kind] >= capFor(kind)) {
      toast({
        title: `Reference ${kind} limit reached`,
        description: `Seedance accepts up to ${capFor(kind)} reference ${kind} files.`,
      })
      return
    }
    setPendingKind(kind)
    setPopoverOpen(false)
    // Let the accept attribute update before opening the OS dialog.
    requestAnimationFrame(() => fileInputRef.current?.click())
  }

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return

    const cap = capFor(pendingKind)
    const remaining = cap - counts[pendingKind]
    if (remaining <= 0) return

    const accepted = files.slice(0, remaining)
    if (accepted.length < files.length) {
      toast({
        title: 'Some files skipped',
        description: `Only ${accepted.length} of ${files.length} added — the limit is ${cap} reference ${pendingKind} files.`,
      })
    }

    try {
      const uploaded: UploadedMedia[] = await mediaUpload.uploadMultiple(accepted)

      // Enforce the combined-duration ceiling per media type.
      const next = [...items]
      for (const media of uploaded) {
        if (media.kind === 'video' || media.kind === 'audio') {
          const already = totalDuration(next, media.kind)
          const incoming = media.durationSeconds ?? 0
          if (already + incoming > limits.maxMediaSeconds) {
            toast({
              title: `Reference ${media.kind} too long`,
              description: `"${media.file.name}" would push the combined ${media.kind} length past ${limits.maxMediaSeconds}s. It was not added.`,
              variant: 'destructive',
            })
            continue
          }
        }

        next.push({
          id: `${media.kind}-${media.path}`,
          kind: media.kind,
          url: media.url,
          previewUrl: media.previewUrl,
          name: media.file.name,
          durationSeconds: media.durationSeconds,
        })
      }

      onItemsChange(next)
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err?.message || 'Could not upload the reference file.',
        variant: 'destructive',
      })
    }
  }

  const removeItem = (id: string) => {
    const removed = items.find((item) => item.id === id)
    if (removed?.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(removed.previewUrl)
    }
    const next = items.filter((item) => item.id !== id)
    // Audio cannot stand alone — drop it if the last visual reference goes.
    const stillVisual = next.some((i) => i.kind === 'image' || i.kind === 'video')
    onItemsChange(stillVisual ? next : next.filter((i) => i.kind !== 'audio'))
  }

  const videoSeconds = totalDuration(items, 'video')
  const audioSeconds = totalDuration(items, 'audio')

  return (
    <div className="flex flex-col gap-1.5">
      {framesInUse && items.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
          <span className="text-xs text-amber-500">
            Seedance can&apos;t use reference sets and start/end frames together — the frames will be ignored.
          </span>
          {onClearFrames && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs shrink-0"
              onClick={onClearFrames}
            >
              Clear frames
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
        {items.map((item) => (
          <div key={item.id} className="relative group flex-shrink-0">
            <div
              className="rounded-md overflow-hidden border-2 border-primary/50 shadow-lg w-[32px] h-[32px] flex items-center justify-center bg-muted"
              title={`${item.name}${item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ''}`}
            >
              {item.kind === 'image' ? (
                <img src={toViewUrl(item.previewUrl)} alt={item.name} className="w-full h-full object-cover" />
              ) : item.kind === 'video' ? (
                <video src={toViewUrl(item.previewUrl)} className="w-full h-full object-cover" muted playsInline />
              ) : (
                <Music className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            {item.kind !== 'image' && item.durationSeconds !== null && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-background/90 px-1 text-[9px] leading-tight text-muted-foreground border border-border">
                {formatDuration(item.durationSeconds)}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeItem(item.id)
              }}
              className="absolute -top-1 -right-1 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
              title="Remove reference"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled || mediaUpload.isUploading}
              className="rounded-md border-2 border-dashed border-white/20 hover:border-primary/50 hover:bg-primary/10 transition-all flex items-center justify-center w-[32px] h-[32px] flex-shrink-0 disabled:opacity-50"
              title="Add a reference image, video, or audio clip"
            >
              {mediaUpload.isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />
              ) : (
                <Plus className="h-3.5 w-3.5 text-muted-foreground/70" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2" align="start">
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8 text-xs"
                onClick={() => openPickerFor('image')}
              >
                <ImagePlus className="h-3.5 w-3.5 mr-2" />
                Image
                <span className="ml-auto text-muted-foreground">
                  {counts.image}/{limits.maxImages}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8 text-xs"
                onClick={() => openPickerFor('video')}
              >
                <Film className="h-3.5 w-3.5 mr-2" />
                Video
                <span className="ml-auto text-muted-foreground">
                  {counts.video}/{limits.maxVideos}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasVisualReference}
                className="w-full justify-start h-8 text-xs"
                title={
                  hasVisualReference
                    ? undefined
                    : 'Add a reference image or video first — Seedance needs one before audio.'
                }
                onClick={() => openPickerFor('audio')}
              >
                <Music className="h-3.5 w-3.5 mr-2" />
                Audio
                <span className="ml-auto text-muted-foreground">
                  {counts.audio}/{limits.maxAudios}
                </span>
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {items.length > 0 && (
          <span className="text-xs text-muted-foreground flex-shrink-0 ml-1 whitespace-nowrap">
            {counts.image} img
            {counts.video > 0 && ` · ${counts.video} vid (${formatDuration(videoSeconds)})`}
            {counts.audio > 0 && ` · ${counts.audio} aud (${formatDuration(audioSeconds)})`}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_BY_KIND[pendingKind]}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          void handleFiles(files)
        }}
      />
    </div>
  )
}
