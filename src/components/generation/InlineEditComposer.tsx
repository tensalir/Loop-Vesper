'use client'

import { useState, useRef, useCallback } from 'react'
import { Loader2, X, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InlineEditComposerProps {
  imageUrl: string
  outputId: string
  onGenerate: (prompt: string, referenceImageUrl: string, outputId: string) => Promise<void>
  onClose: () => void
  className?: string
}

/**
 * Minimal inline prompt bar that appears over an image card for quick edits.
 * Generates an edited branch of the selected image without leaving the gallery flow.
 */
export function InlineEditComposer({
  imageUrl,
  outputId,
  onGenerate,
  onClose,
  className,
}: InlineEditComposerProps) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return
    setIsGenerating(true)
    try {
      await onGenerate(prompt.trim(), imageUrl, outputId)
      setPrompt('')
      onClose()
    } catch {
      // Error handling done in parent
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, isGenerating, onGenerate, imageUrl, outputId, onClose])

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 p-2',
        'bg-gradient-to-t from-black/80 via-black/60 to-transparent',
        'backdrop-blur-sm',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Describe the edit..."
          autoFocus
          disabled={isGenerating}
          className={cn(
            'flex-1 h-7 px-2 text-[11px] rounded-md',
            'bg-white/10 border border-white/20 text-white placeholder:text-white/40',
            'focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30',
            'disabled:opacity-50'
          )}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!prompt.trim() || isGenerating}
          className="p-1.5 rounded-md bg-primary/80 hover:bg-primary text-primary-foreground transition-colors disabled:opacity-40"
          title="Generate edit"
        >
          {isGenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
