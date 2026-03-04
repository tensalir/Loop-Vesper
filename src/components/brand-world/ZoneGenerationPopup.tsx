'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { X, Sparkles, Image as ImageIcon, Video, Loader2 } from 'lucide-react'
import { useGenerateMutation } from '@/hooks/useGenerateMutation'
import { useModels } from '@/hooks/useModels'
import { useSessions } from '@/hooks/useSessions'
import { useToast } from '@/components/ui/use-toast'
import { zoneSessionName } from '@/lib/brand-world/world-config'
import type { StageConfig } from '@/lib/brand-world/world-config'

interface ZoneGenerationPopupProps {
  stage: StageConfig
  projectId: string
  onClose: () => void
}

export function ZoneGenerationPopup({ stage, projectId, onClose }: ZoneGenerationPopupProps) {
  const { toast } = useToast()
  const [prompt, setPrompt] = useState(
    `Festival ${stage.name.toLowerCase()} scene, vibrant atmosphere`
  )
  const [genType, setGenType] = useState<'image' | 'video'>('image')
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const sessionCreatedRef = useRef(false)

  const { data: allModels = [] } = useModels()
  const { data: sessions = [] } = useSessions(projectId)
  const generateMutation = useGenerateMutation()

  const modelsForType = allModels.filter((m) => m.type === genType)

  useEffect(() => {
    if (modelsForType.length > 0 && !selectedModel) {
      setSelectedModel(modelsForType[0].id)
    }
  }, [modelsForType, selectedModel])

  useEffect(() => {
    const match = modelsForType.find((m) => m.id === selectedModel)
    if (!match && modelsForType.length > 0) {
      setSelectedModel(modelsForType[0].id)
    }
  }, [genType, modelsForType, selectedModel])

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
        body: JSON.stringify({
          projectId,
          name: targetName,
          type: genType,
        }),
      })
      if (!res.ok) throw new Error('Failed to create session')
      const session = await res.json()
      return session.id as string
    } catch (err) {
      sessionCreatedRef.current = false
      return null
    }
  }, [sessions, genType, projectId, stage.sessionPrefix])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || !selectedModel) return

    setIsSubmitting(true)
    try {
      const sessionId = await findOrCreateZoneSession()
      if (!sessionId) {
        toast({ title: 'Error', description: 'Could not resolve zone session.', variant: 'destructive' })
        return
      }

      await generateMutation.mutateAsync({
        sessionId,
        modelId: selectedModel,
        prompt: prompt.trim(),
        parameters: {
          aspectRatio: '16:9',
          resolution: 1024,
          numOutputs: 1,
          brandWorldStageId: stage.id,
        },
      })

      toast({
        title: 'Generation started',
        description: `Generating ${genType} for ${stage.name}...`,
      })
      onClose()
    } catch (err: any) {
      toast({
        title: 'Generation failed',
        description: err.message || 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [prompt, selectedModel, genType, stage, findOrCreateZoneSession, generateMutation, toast, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleGenerate()
      }
    },
    [handleGenerate]
  )

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div
        className="w-[460px] max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-md border border-border/60 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">Generate for {stage.name}</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex gap-1 p-0.5 bg-muted/50 rounded-lg w-fit">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 block">
              Model
            </label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelsForType.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 block">
              Prompt
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Describe the ${genType} you want to generate...`}
              className="min-h-[80px] text-sm resize-none"
              autoFocus
            />
          </div>
        </div>

        <div className="px-5 pb-4">
          <Button
            className="w-full gap-2 h-9"
            disabled={!prompt.trim() || !selectedModel || isSubmitting}
            onClick={handleGenerate}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Generate {genType}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
