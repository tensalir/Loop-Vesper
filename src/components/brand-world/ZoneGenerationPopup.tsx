'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { X, Sparkles, Image as ImageIcon, Video } from 'lucide-react'
import { ChatInput } from '@/components/generation/ChatInput'
import { VideoInput } from '@/components/generation/VideoInput'
import { useGenerateMutation } from '@/hooks/useGenerateMutation'
import { useModels } from '@/hooks/useModels'
import { useSessions } from '@/hooks/useSessions'
import { useUIStore } from '@/store/uiStore'
import { useToast } from '@/components/ui/use-toast'
import { zoneSessionName } from '@/lib/brand-world/world-config'
import type { StageConfig } from '@/lib/brand-world/world-config'
import type { PendingGeneration } from '@/lib/brand-world/placement'

const DEFAULT_VIDEO_MODEL_ID = 'kling-official'

function getPreferredModelId(models: { id: string; type: string }[], type: 'image' | 'video'): string | null {
  const ofType = models.filter((m) => m.type === type)
  if (type === 'video') {
    const preferred = ofType.find((m) => m.id === DEFAULT_VIDEO_MODEL_ID)
    return preferred?.id ?? ofType[0]?.id ?? null
  }
  return ofType[0]?.id ?? null
}

interface ZoneGenerationPopupProps {
  stage: StageConfig
  projectId: string
  onClose: () => void
  onGenerationStarted?: (gen: PendingGeneration) => void
}

export function ZoneGenerationPopup({ stage, projectId, onClose, onGenerationStarted }: ZoneGenerationPopupProps) {
  const { toast } = useToast()
  const [genType, setGenType] = useState<'image' | 'video'>('image')
  const [prompt, setPrompt] = useState(
    `Festival ${stage.name.toLowerCase()} scene, vibrant atmosphere`
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const sessionCreatedRef = useRef(false)

  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null)
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([])

  const { selectedModel, parameters, setSelectedModel, setParameters } = useUIStore()
  const { data: allModels = [] } = useModels()
  const { data: sessions = [] } = useSessions(projectId)
  const generateMutation = useGenerateMutation()

  useEffect(() => {
    if (allModels.length === 0) return
    const current = allModels.find((m) => m.id === selectedModel)
    if (!current || current.type !== genType) {
      const fallback = getPreferredModelId(allModels, genType)
      if (fallback) {
        setSelectedModel(fallback)
        if (genType === 'video') {
          setParameters({ aspectRatio: '16:9', resolution: 720, numOutputs: 1, duration: 5 })
        }
      }
    }
  }, [genType, allModels, selectedModel, setSelectedModel, setParameters])

  const findOrCreateZoneSession = useCallback(async (): Promise<string | null> => {
    const targetName = zoneSessionName(stage.sessionPrefix, genType)
    const existing = sessions.find((s) => s.name === targetName && s.type === genType)
    if (existing) return existing.id

    if (sessionCreatedRef.current) return null

    try {
      sessionCreatedRef.current = true
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name: targetName, type: genType }),
      })
      if (!res.ok) throw new Error('Failed to create session')
      const session = await res.json()
      return session.id as string
    } catch {
      sessionCreatedRef.current = false
      return null
    }
  }, [sessions, genType, projectId, stage.sessionPrefix])

  const handleImageGenerate = useCallback(
    async (
      promptText: string,
      options?: { referenceImage?: File; referenceImages?: File[] }
    ) => {
      if (!promptText.trim()) return
      setIsSubmitting(true)
      try {
        const sessionId = await findOrCreateZoneSession()
        if (!sessionId) {
          toast({ title: 'Error', description: 'Could not resolve zone session.', variant: 'destructive' })
          return
        }

        const referenceImagesData: string[] | undefined =
          options?.referenceImages && options.referenceImages.length > 0
            ? await Promise.all(options.referenceImages.map(fileToDataUrl))
            : undefined

        const referenceImageData: string | undefined =
          !referenceImagesData && options?.referenceImage
            ? await fileToDataUrl(options.referenceImage)
            : undefined

        const result = await generateMutation.mutateAsync({
          sessionId,
          modelId: selectedModel,
          prompt: promptText.trim(),
          parameters: {
            aspectRatio: parameters.aspectRatio,
            resolution: parameters.resolution,
            numOutputs: parameters.numOutputs,
            brandWorldStageId: stage.id,
            ...(referenceImagesData && { referenceImages: referenceImagesData }),
            ...(referenceImageData && { referenceImage: referenceImageData }),
          },
        })

        onGenerationStarted?.({
          id: result.id,
          stageId: stage.id,
          prompt: promptText.trim(),
          genType: 'image',
          createdAt: new Date().toISOString(),
        })

        toast({ title: 'Generation started', description: `Generating image for ${stage.name}...` })
        onClose()
      } catch (err: any) {
        toast({ title: 'Generation failed', description: err.message || 'Something went wrong.', variant: 'destructive' })
      } finally {
        setIsSubmitting(false)
      }
    },
    [selectedModel, parameters, stage, findOrCreateZoneSession, generateMutation, toast, onClose]
  )

  const handleVideoGenerate = useCallback(
    async (
      promptText: string,
      options?: {
        referenceImage?: File
        referenceImageId?: string
        referenceImageUrl?: string
        endFrameImage?: File
        endFrameImageId?: string
        endFrameImageUrl?: string
      }
    ) => {
      if (!promptText.trim()) return
      setIsSubmitting(true)
      try {
        const sessionId = await findOrCreateZoneSession()
        if (!sessionId) {
          toast({ title: 'Error', description: 'Could not resolve zone session.', variant: 'destructive' })
          return
        }

        let refImageData: string | undefined
        let refImageUrl: string | undefined
        if (options?.referenceImageUrl) {
          refImageUrl = options.referenceImageUrl
        } else if (options?.referenceImage) {
          refImageData = await fileToDataUrl(options.referenceImage)
        }

        let endFrameData: string | undefined
        let endFrameUrl: string | undefined
        if (options?.endFrameImageUrl) {
          endFrameUrl = options.endFrameImageUrl
        } else if (options?.endFrameImage) {
          endFrameData = await fileToDataUrl(options.endFrameImage)
        }

        const result = await generateMutation.mutateAsync({
          sessionId,
          modelId: selectedModel,
          prompt: promptText.trim(),
          parameters: {
            aspectRatio: parameters.aspectRatio,
            resolution: parameters.resolution,
            numOutputs: parameters.numOutputs,
            ...(parameters.duration && { duration: parameters.duration }),
            brandWorldStageId: stage.id,
            ...(refImageUrl && { referenceImageUrl: refImageUrl }),
            ...(refImageData && !refImageUrl && { referenceImage: refImageData }),
            ...(options?.referenceImageId && { referenceImageId: options.referenceImageId }),
            ...(endFrameUrl && { endFrameImageUrl: endFrameUrl }),
            ...(endFrameData && !endFrameUrl && { endFrameImage: endFrameData }),
            ...(options?.endFrameImageId && { endFrameImageId: options.endFrameImageId }),
          },
        })

        onGenerationStarted?.({
          id: result.id,
          stageId: stage.id,
          prompt: promptText.trim(),
          genType: 'video',
          createdAt: new Date().toISOString(),
        })

        toast({ title: 'Generation started', description: `Generating video for ${stage.name}...` })
        onClose()
      } catch (err: any) {
        toast({ title: 'Generation failed', description: err.message || 'Something went wrong.', variant: 'destructive' })
      } finally {
        setIsSubmitting(false)
      }
    },
    [selectedModel, parameters, stage, findOrCreateZoneSession, generateMutation, toast, onClose]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-20 flex items-end justify-center pb-6 bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">Generate for {stage.name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 p-0.5 bg-muted/50 rounded-lg">
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  genType === 'image'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setGenType('image')}
              >
                <ImageIcon className="h-3 w-3" />
                Image
              </button>
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  genType === 'video'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setGenType('video')}
              >
                <Video className="h-3 w-3" />
                Video
              </button>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="px-5 py-4">
          {genType === 'image' ? (
            <ChatInput
              prompt={prompt}
              onPromptChange={setPrompt}
              onGenerate={handleImageGenerate}
              parameters={parameters}
              onParametersChange={(p) => setParameters(p)}
              generationType="image"
              selectedModel={selectedModel}
              onModelSelect={setSelectedModel}
              isGenerating={isSubmitting}
              referenceImageUrls={referenceImageUrls}
              onReferenceImageUrlsChange={setReferenceImageUrls}
            />
          ) : (
            <VideoInput
              prompt={prompt}
              onPromptChange={setPrompt}
              onGenerate={handleVideoGenerate}
              parameters={parameters}
              onParametersChange={(p) => setParameters(p)}
              selectedModel={selectedModel}
              onModelSelect={setSelectedModel}
              referenceImageUrl={referenceImageUrl}
              onClearReferenceImage={() => setReferenceImageUrl(null)}
              onSetReferenceImageUrl={setReferenceImageUrl}
              isGenerating={isSubmitting}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
