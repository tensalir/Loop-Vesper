'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronUp, Star } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ModelPickerProps {
  selectedModel: string
  onModelSelect: (modelId: string) => void
  generationType: 'image' | 'video'
}

interface Model {
  id: string
  name: string
  provider: string
  description: string
  type: 'image' | 'video'
  maxResolution?: number
}

export function ModelPicker({
  selectedModel,
  onModelSelect,
  generationType,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [pinnedModels, setPinnedModels] = useState<string[]>(['gemini-nano-banana-pro'])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch models from API
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch(`/api/models?type=${generationType}`)
        const data = await response.json()
        setModels(data.models || [])
      } catch (error) {
        console.error('Failed to fetch models:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchModels()
  }, [generationType])

  const selectedModelData = models.find((m) => m.id === selectedModel)

  const togglePin = (modelId: string) => {
    setPinnedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    )
  }

  const handleSelectModel = (modelId: string) => {
    onModelSelect(modelId)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        className="bg-card shadow-lg"
        onClick={() => setOpen(true)}
      >
        <span className="mr-2">Model:</span>
        <span className="font-semibold">{selectedModelData?.name || 'Select model'}</span>
        <ChevronUp className="ml-2 h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select AI Model</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Pinned Models */}
            {pinnedModels.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
                  PINNED MODELS
                </h3>
                <div className="space-y-2">
                  {models
                    .filter((m) => pinnedModels.includes(m.id))
                    .map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        isSelected={selectedModel === model.id}
                        isPinned={true}
                        onSelect={handleSelectModel}
                        onTogglePin={togglePin}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* All Models */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
                ALL {generationType.toUpperCase()} MODELS
              </h3>
              <div className="space-y-2">
                {models
                  .filter((m) => !pinnedModels.includes(m.id))
                  .map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      isSelected={selectedModel === model.id}
                      isPinned={false}
                      onSelect={handleSelectModel}
                      onTogglePin={togglePin}
                    />
                  ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ModelCardProps {
  model: any
  isSelected: boolean
  isPinned: boolean
  onSelect: (id: string) => void
  onTogglePin: (id: string) => void
}

function ModelCard({
  model,
  isSelected,
  isPinned,
  onSelect,
  onTogglePin,
}: ModelCardProps) {
  const capabilities = model.capabilities || {}
  
  return (
    <button
      onClick={() => onSelect(model.id)}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-muted'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h4 className="font-semibold">{model.name}</h4>
            
            {/* Capability badges */}
            {capabilities.editing && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium">
                editing
              </span>
            )}
            {capabilities['text-2-image'] && (
              <span className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium">
                text-2-image
              </span>
            )}
            
            {/* Speed badge */}
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              model.speed === 'fast'
                ? 'bg-green-500/10 text-green-500'
                : model.speed === 'medium'
                ? 'bg-yellow-500/10 text-yellow-500'
                : 'bg-red-500/10 text-red-500'
            }`}>
              {model.speed}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-1">{model.provider}</p>
          <p className="text-sm">{model.description}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin(model.id)
          }}
          className={`p-2 rounded-lg hover:bg-background transition-colors ${
            isPinned ? 'text-yellow-500' : 'text-muted-foreground'
          }`}
        >
          <Star className={`h-4 w-4 ${isPinned ? 'fill-current' : ''}`} />
        </button>
      </div>
    </button>
  )
}

