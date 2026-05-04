'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  Layers,
  Loader2,
  Copy,
  CheckCheck,
  Wand2,
  Send,
  Lock,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react'

export interface IterationVariant {
  label: string
  axis: Record<string, string>
  prompt: string
  preserve: string[]
  change: string[]
  whyDifferentEnough: string
}

export interface IterationSlate {
  theme: string
  anchors: {
    product?: string
    offer?: string
    audience?: string
    brand?: string
    lockedText?: string
  }
  axesVaried: string[]
  weakChangesAvoided: string[]
  variants: IterationVariant[]
}

interface IterationSlateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The user's current baseline prompt. */
  baselinePrompt: string
  /** Selected generation model id. */
  modelId: string
  /** Optional baseline reference image (data URL, blob URL, or http URL). */
  referenceImage?: string | File | null
  /** Optional id of the source generated output (for branch metadata). */
  baselineOutputId?: string
  /** Apply a variant prompt to the main prompt textarea. */
  onApplyToPrompt: (prompt: string) => void
  /**
   * Optional: directly trigger generation of a single variant. When provided,
   * each variant card gets a "Generate this variant" button. The dialog will
   * stay open so the user can ship multiple variants.
   */
  onGenerateVariant?: (args: {
    prompt: string
    sourceLabel: string
    referenceImage?: string | File | null
    baselineOutputId?: string
  }) => Promise<void> | void
}

const ALL_AXES = [
  { id: 'concept', label: 'Concept / Angle' },
  { id: 'format', label: 'Format' },
  { id: 'aspectRatio', label: 'Aspect Ratio' },
  { id: 'persona', label: 'Persona' },
  { id: 'treatment', label: 'Visual Treatment' },
  { id: 'copyStyle', label: 'Copy Style' },
  { id: 'generator', label: 'Generator' },
] as const

type AxisId = (typeof ALL_AXES)[number]['id']
type AxisState = 'auto' | 'vary' | 'lock'

const AXIS_PRESETS: Array<{ id: string; label: string; vary: AxisId[] }> = [
  { id: 'auto', label: 'Auto (let AI pick)', vary: [] },
  { id: 'concept-persona', label: 'Concept x Persona', vary: ['concept', 'persona'] },
  { id: 'concept-format', label: 'Concept x Format', vary: ['concept', 'format'] },
  { id: 'persona-treatment', label: 'Persona x Visual treatment', vary: ['persona', 'treatment'] },
  { id: 'concept-aspect', label: 'Concept x Aspect ratio', vary: ['concept', 'aspectRatio'] },
]

const VARIANT_COUNT_OPTIONS = [3, 4, 5, 6]

async function compressImage(referenceImage: string | File): Promise<string | null> {
  // Reuse the same flow as PromptEnhancementButton: convert to compressed JPEG data URL
  // for safe transport. Keep a local copy here to avoid coupling.
  let blob: Blob
  if (referenceImage instanceof File) {
    blob = referenceImage
  } else if (typeof referenceImage === 'string') {
    if (
      !referenceImage.startsWith('data:') &&
      !referenceImage.startsWith('blob:') &&
      !referenceImage.startsWith('http')
    ) {
      return null
    }
    const res = await fetch(referenceImage)
    if (!res.ok) return null
    blob = await res.blob()
  } else {
    return null
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const maxDim = 1024
    let { width, height } = img
    if (width > maxDim || height > maxDim) {
      const ratio = maxDim / Math.max(width, height)
      width = Math.floor(width * ratio)
      height = Math.floor(height * ratio)
    }

    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0, width, height)

    let quality = 0.82
    let dataUrl = canvas.toDataURL('image/jpeg', quality)
    let attempts = 0
    while (dataUrl.length > 2 * 1024 * 1024 * 1.4 && attempts < 4 && quality > 0.5) {
      attempts += 1
      quality = Math.max(0.5, quality - 0.1)
      dataUrl = canvas.toDataURL('image/jpeg', quality)
    }
    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function IterationSlateDialog({
  open,
  onOpenChange,
  baselinePrompt,
  modelId,
  referenceImage,
  baselineOutputId,
  onApplyToPrompt,
  onGenerateVariant,
}: IterationSlateDialogProps) {
  const { toast } = useToast()
  const [variantCount, setVariantCount] = useState(4)
  const [axisStates, setAxisStates] = useState<Record<AxisId, AxisState>>(() => ({
    concept: 'auto',
    format: 'auto',
    aspectRatio: 'auto',
    persona: 'auto',
    treatment: 'auto',
    copyStyle: 'auto',
    generator: 'auto',
  }))
  const [anchorsExpanded, setAnchorsExpanded] = useState(false)
  const [anchors, setAnchors] = useState({
    product: '',
    offer: '',
    audience: '',
    brand: '',
    lockedText: '',
    theme: '',
  })
  const [generating, setGenerating] = useState(false)
  const [slate, setSlate] = useState<IterationSlate | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null)

  const preferredAxes = useMemo<AxisId[]>(
    () => ALL_AXES.filter((a) => axisStates[a.id] === 'vary').map((a) => a.id),
    [axisStates]
  )
  const lockedAxes = useMemo<AxisId[]>(
    () => ALL_AXES.filter((a) => axisStates[a.id] === 'lock').map((a) => a.id),
    [axisStates]
  )

  const applyPreset = useCallback((presetId: string) => {
    const preset = AXIS_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setAxisStates((prev) => {
      const next: Record<AxisId, AxisState> = { ...prev }
      ALL_AXES.forEach((a) => {
        next[a.id] = preset.vary.includes(a.id) ? 'vary' : 'auto'
      })
      return next
    })
  }, [])

  const cycleAxis = useCallback((axisId: AxisId) => {
    setAxisStates((prev) => {
      const current = prev[axisId]
      const nextState: AxisState =
        current === 'auto' ? 'vary' : current === 'vary' ? 'lock' : 'auto'
      return { ...prev, [axisId]: nextState }
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!baselinePrompt.trim()) {
      toast({
        title: 'Add a baseline prompt first',
        description: 'Type the concept or paste an existing prompt before generating iterations.',
        variant: 'destructive',
      })
      return
    }
    setGenerating(true)
    setSlate(null)
    try {
      const compressedImage = referenceImage ? await compressImage(referenceImage) : null

      const cleanedAnchors = Object.fromEntries(
        Object.entries(anchors)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => typeof v === 'string' && (v as string).length > 0)
      ) as Record<string, string>

      const res = await fetch('/api/prompts/iterate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: baselinePrompt,
          modelId,
          referenceImage: compressedImage || undefined,
          baselineOutputId,
          anchors: Object.keys(cleanedAnchors).length > 0 ? cleanedAnchors : undefined,
          variantCount,
          preferredAxes: preferredAxes.length > 0 ? preferredAxes : undefined,
          lockedAxes: lockedAxes.length > 0 ? lockedAxes : undefined,
        }),
      })

      if (!res.ok) {
        let message = `HTTP ${res.status}`
        try {
          const data = await res.json()
          message = data.error || data.details || message
        } catch {
          // ignore
        }
        throw new Error(message)
      }

      const data = (await res.json()) as { slate: IterationSlate }
      setSlate(data.slate)
    } catch (err) {
      const e = err as Error
      toast({
        title: 'Iteration failed',
        description: e.message || 'Could not produce a slate.',
        variant: 'destructive',
      })
    } finally {
      setGenerating(false)
    }
  }, [
    baselinePrompt,
    modelId,
    referenceImage,
    baselineOutputId,
    anchors,
    variantCount,
    preferredAxes,
    lockedAxes,
    toast,
  ])

  const handleCopy = useCallback(
    async (idx: number, prompt: string) => {
      try {
        await navigator.clipboard.writeText(prompt)
        setCopiedIdx(idx)
        setTimeout(() => setCopiedIdx((curr) => (curr === idx ? null : curr)), 1500)
      } catch {
        toast({
          title: 'Copy failed',
          description: 'Clipboard not available.',
          variant: 'destructive',
        })
      }
    },
    [toast]
  )

  const handleApply = useCallback(
    (prompt: string) => {
      onApplyToPrompt(prompt)
      toast({ title: 'Variant applied to prompt' })
      onOpenChange(false)
    },
    [onApplyToPrompt, onOpenChange, toast]
  )

  const handleGenerateVariant = useCallback(
    async (idx: number, variant: IterationVariant) => {
      if (!onGenerateVariant) return
      setGeneratingIdx(idx)
      try {
        await onGenerateVariant({
          prompt: variant.prompt,
          sourceLabel: variant.label,
          referenceImage,
          baselineOutputId,
        })
      } finally {
        setGeneratingIdx(null)
      }
    },
    [onGenerateVariant, referenceImage, baselineOutputId]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            {"Create iterations (Andromeda-aware)"}
          </DialogTitle>
          <DialogDescription>
            {
              "Build a small slate of meaningfully different variants from your baseline. Locks anchors (product, offer, audience, brand) and varies 2\u20133 diversification axes so Meta sees them as distinct ads."
            }
          </DialogDescription>
        </DialogHeader>

        {/* Baseline summary */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
          <div className="text-xs text-muted-foreground mb-1">{"Baseline prompt"}</div>
          <div className="line-clamp-3 whitespace-pre-wrap text-sm">
            {baselinePrompt || (
              <span className="italic text-muted-foreground">{"(empty \u2014 fill the prompt bar first)"}</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {"Model: "}
              <span className="text-foreground/80">{modelId}</span>
            </span>
            {referenceImage && <Badge variant="secondary">{"Baseline image attached"}</Badge>}
            {baselineOutputId && <Badge variant="outline">{"Branching from output"}</Badge>}
          </div>
        </div>

        {/* Anchors */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setAnchorsExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors"
          >
            {anchorsExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {"Anchors (what stays constant)"}
            <span className="text-xs font-normal text-muted-foreground">
              {"\u2014 optional, but improves coherence"}
            </span>
          </button>
          {anchorsExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-5">
              <div>
                <Label htmlFor="anchor-product" className="text-xs">
                  {"Product / SKU"}
                </Label>
                <Input
                  id="anchor-product"
                  value={anchors.product}
                  onChange={(e) => setAnchors((a) => ({ ...a, product: e.target.value }))}
                  placeholder="e.g. Loop Quiet 2"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="anchor-offer" className="text-xs">
                  {"Offer"}
                </Label>
                <Input
                  id="anchor-offer"
                  value={anchors.offer}
                  onChange={(e) => setAnchors((a) => ({ ...a, offer: e.target.value }))}
                  placeholder="e.g. -20% launch"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="anchor-audience" className="text-xs">
                  {"Audience cohort"}
                </Label>
                <Input
                  id="anchor-audience"
                  value={anchors.audience}
                  onChange={(e) => setAnchors((a) => ({ ...a, audience: e.target.value }))}
                  placeholder="e.g. focus-workers 25-40"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="anchor-theme" className="text-xs">
                  {"Theme / through-line"}
                </Label>
                <Input
                  id="anchor-theme"
                  value={anchors.theme}
                  onChange={(e) => setAnchors((a) => ({ ...a, theme: e.target.value }))}
                  placeholder="One sentence that every variant honors"
                  className="h-8 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="anchor-brand" className="text-xs">
                  {"Brand non-negotiables"}
                </Label>
                <Textarea
                  id="anchor-brand"
                  value={anchors.brand}
                  onChange={(e) => setAnchors((a) => ({ ...a, brand: e.target.value }))}
                  placeholder="Logo placement, palette boundaries, voice, claims to avoid"
                  className="min-h-[60px] text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="anchor-locked" className="text-xs">
                  {"Locked text (must not change)"}
                </Label>
                <Textarea
                  id="anchor-locked"
                  value={anchors.lockedText}
                  onChange={(e) => setAnchors((a) => ({ ...a, lockedText: e.target.value }))}
                  placeholder='Headline / CTA / mandatory legal copy. e.g. "Stay in the moment" + "Reduce distractions"'
                  className="min-h-[60px] text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Axis selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">{"Diversification axes"}</Label>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              {"Click to cycle: auto \u2192 vary \u2192 lock"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_AXES.map((axis) => {
              const state = axisStates[axis.id]
              return (
                <button
                  key={axis.id}
                  type="button"
                  onClick={() => cycleAxis(axis.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    state === 'auto' &&
                      'border-border bg-muted/40 text-muted-foreground hover:border-primary/50',
                    state === 'vary' &&
                      'border-primary/60 bg-primary/15 text-primary hover:bg-primary/20',
                    state === 'lock' &&
                      'border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                  )}
                >
                  {state === 'lock' && <Lock className="h-3 w-3" />}
                  {axis.label}
                  {state === 'vary' && (
                    <span className="text-[10px] opacity-70">{"vary"}</span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {AXIS_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Variant count */}
        <div className="flex items-center gap-3">
          <Label className="text-sm">{"Variants"}</Label>
          <div className="flex items-center gap-1">
            {VARIANT_COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setVariantCount(n)}
                className={cn(
                  'h-7 w-7 rounded-md text-xs font-semibold transition-colors',
                  variantCount === n
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>
            {"Cancel"}
          </Button>
          <Button onClick={handleGenerate} disabled={generating || !baselinePrompt.trim()}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {"Building slate"}
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                {slate ? 'Rebuild slate' : 'Build slate'}
              </>
            )}
          </Button>
        </div>

        {/* Slate output */}
        {slate && (
          <div className="space-y-3 pt-2 border-t border-border/40">
            <div className="space-y-1.5">
              <div className="text-sm">
                <span className="font-semibold">{"Theme: "}</span>
                <span className="text-muted-foreground">{slate.theme}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center">
                  {"Axes varied:"}
                </span>
                {slate.axesVaried.map((a) => (
                  <Badge key={a} variant="secondary" className="text-[10px]">
                    {a}
                  </Badge>
                ))}
              </div>
              {slate.weakChangesAvoided?.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">
                    {"Why these variants \u2014 weak changes avoided"}
                  </summary>
                  <ul className="list-disc pl-5 pt-1 space-y-0.5">
                    {slate.weakChangesAvoided.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <div className="space-y-2">
              {slate.variants.map((variant, idx) => {
                const axisChips = Object.entries(variant.axis || {})
                return (
                  <div
                    key={`${variant.label}-${idx}`}
                    className="rounded-lg border border-border/60 bg-card p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{variant.label}</div>
                        {axisChips.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {axisChips.map(([k, v]) => (
                              <Badge
                                key={`${k}-${v}`}
                                variant="outline"
                                className="text-[10px] font-normal"
                              >
                                <span className="text-muted-foreground mr-1">{k}:</span>
                                {v}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-muted/40 rounded-md p-2.5 border border-border/40 max-h-48 overflow-y-auto">
                      {variant.prompt}
                    </pre>

                    {variant.whyDifferentEnough && (
                      <div className="text-[11px] text-muted-foreground italic">
                        {"Why different enough: "}
                        {variant.whyDifferentEnough}
                      </div>
                    )}

                    {(variant.preserve?.length > 0 || variant.change?.length > 0) && (
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        {variant.preserve?.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">{"Preserves:"}</span>
                            {variant.preserve.map((p, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-normal">
                                {p}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {variant.change?.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">{"Changes:"}</span>
                            {variant.change.map((c, i) => (
                              <Badge
                                key={i}
                                variant="secondary"
                                className="text-[10px] font-normal"
                              >
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 pt-1">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => handleApply(variant.prompt)}
                      >
                        {"Apply to prompt"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleCopy(idx, variant.prompt)}
                      >
                        {copiedIdx === idx ? (
                          <>
                            <CheckCheck className="h-3 w-3 mr-1" />
                            {"Copied"}
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            {"Copy"}
                          </>
                        )}
                      </Button>
                      {onGenerateVariant && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          disabled={generatingIdx === idx}
                          onClick={() => handleGenerateVariant(idx, variant)}
                        >
                          {generatingIdx === idx ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              {"Generating"}
                            </>
                          ) : (
                            <>
                              <Send className="h-3 w-3 mr-1" />
                              {"Generate this variant"}
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
