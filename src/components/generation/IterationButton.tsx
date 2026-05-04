'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Layers } from 'lucide-react'
import { IterationSlateDialog } from './IterationSlateDialog'

interface IterationButtonProps {
  prompt: string
  modelId: string
  referenceImage?: string | File | null
  /** Optional baseline output id when iterating from an existing generation. */
  baselineOutputId?: string
  /** Apply a single chosen variant prompt back to the parent prompt textarea. */
  onApplyToPrompt: (prompt: string) => void
  /** Optional: generate a variant directly (used from the gallery to create branches). */
  onGenerateVariant?: (args: {
    prompt: string
    sourceLabel: string
    referenceImage?: string | File | null
    baselineOutputId?: string
  }) => Promise<void> | void
  disabled?: boolean
  /** Override positioning for non-textarea hosts (e.g. inline edit composer). */
  className?: string
  /** Title / aria-label for the trigger. */
  title?: string
}

/**
 * Small icon button that opens the Andromeda-aware iteration dialog.
 *
 * Sits beside the existing PromptEnhancementButton (wand). The wand still
 * rewrites a single prompt; this button opens a slate of meaningfully
 * different variants that respect the locked anchors of the ad set.
 */
export function IterationButton({
  prompt,
  modelId,
  referenceImage,
  baselineOutputId,
  onApplyToPrompt,
  onGenerateVariant,
  disabled = false,
  className,
  title = 'Create iterations (Andromeda-aware)',
}: IterationButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        disabled={disabled || !prompt.trim()}
        className={
          className ??
          'absolute right-9 top-3 h-6 w-6 text-muted-foreground hover:text-primary transition-colors disabled:opacity-0 disabled:pointer-events-none'
        }
        title={title}
        aria-label={title}
      >
        <Layers className="h-4 w-4" />
      </Button>
      <IterationSlateDialog
        open={open}
        onOpenChange={setOpen}
        baselinePrompt={prompt}
        modelId={modelId}
        referenceImage={referenceImage}
        baselineOutputId={baselineOutputId}
        onApplyToPrompt={onApplyToPrompt}
        onGenerateVariant={onGenerateVariant}
      />
    </>
  )
}
