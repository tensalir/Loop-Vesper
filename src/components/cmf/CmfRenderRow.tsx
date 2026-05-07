'use client'

import { useMemo, useState } from 'react'
import {
  CmfRender,
  useCmfClowns,
  useGenerateCmfRender,
  useUpdateCmfRender,
} from '@/hooks/useCmf'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import {
  Loader2,
  Wand2,
  RotateCw,
  ImageIcon,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface CmfRenderRowProps {
  render: CmfRender
  packetId: string
}

/**
 * Per-SKU row, redesigned around a tiny three-node pipeline:
 *
 *   [clown ref] —— [recoloured render] —— [spec breakdown]
 *
 * Each node mirrors the parent pipeline's status language so a designer can
 * scan a packet vertically and immediately see which SKU is gating progress.
 * Fields collapse behind an "Edit" toggle to keep the row dense.
 */
export function CmfRenderRow({ render, packetId }: CmfRenderRowProps) {
  const { data: clowns } = useCmfClowns(render.productSlug)
  const updateMutation = useUpdateCmfRender()
  const generateMutation = useGenerateCmfRender()
  const { toast } = useToast()

  const [expanded, setExpanded] = useState(false)
  const [label, setLabel] = useState(render.label)
  const [colorwayName, setColorwayName] = useState(render.colorwayName ?? '')
  const [productCode, setProductCode] = useState(render.productCode ?? '')
  const [clownAssetId, setClownAssetId] = useState<string | null>(
    render.clownAssetId
  )

  const dirty = useMemo(
    () =>
      label !== render.label ||
      colorwayName !== (render.colorwayName ?? '') ||
      productCode !== (render.productCode ?? '') ||
      clownAssetId !== render.clownAssetId,
    [label, colorwayName, productCode, clownAssetId, render]
  )

  // Resolve the matching clown asset for the visual ref node. If the user
  // hasn't picked one explicitly, fall back to the first clown that matches
  // this SKU's product slug — same heuristic the render service uses.
  const matchedClown = useMemo(() => {
    if (clownAssetId) {
      return clowns?.find((c) => c.id === clownAssetId) ?? null
    }
    return (
      clowns?.find(
        (c) =>
          c.productSlug === render.productSlug &&
          c.variantSlug === (render.variantSlug || 'default')
      ) ?? null
    )
  }, [clowns, clownAssetId, render.productSlug, render.variantSlug])

  const isRendering =
    generateMutation.isPending || render.status === 'rendering'

  async function handleSave() {
    try {
      await updateMutation.mutateAsync({
        renderId: render.id,
        packetId,
        data: {
          label,
          colorwayName: colorwayName || null,
          productCode: productCode || null,
          clownAssetId,
        },
      })
      toast({ title: 'SKU saved' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      toast({ title: 'Save failed', description: message })
    }
  }

  async function handleRender() {
    try {
      if (dirty) await handleSave()
      await generateMutation.mutateAsync({ renderId: render.id, packetId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Render failed'
      toast({ title: `Render failed: ${render.label}`, description: message })
    }
  }

  // Status palette mirrors the pipeline header.
  const refStatus: 'ready' | 'pending' = matchedClown ? 'ready' : 'pending'
  const renderStatus = render.status

  return (
    <article
      className={cn(
        'rounded-2xl border transition-colors',
        renderStatus === 'ready' && 'border-primary/30 bg-card/30',
        renderStatus === 'rendering' && 'border-amber-400/40 bg-card/30',
        renderStatus === 'failed' && 'border-destructive/40 bg-card/30',
        renderStatus !== 'ready' &&
          renderStatus !== 'rendering' &&
          renderStatus !== 'failed' &&
          'border-border/50 bg-card/20'
      )}
    >
      {/* Mini pipeline: clown → render → spec */}
      <div className="grid gap-3 md:gap-0 md:grid-cols-[180px_44px_1fr_44px_minmax(220px,260px)] items-stretch p-3 md:p-4">
        {/* 01 — Clown reference */}
        <PipelineNode
          label="Reference"
          number="01"
          status={refStatus}
          empty={!matchedClown}
        >
          {matchedClown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={matchedClown.imageUrl}
              alt={matchedClown.label}
              className="w-full h-full object-contain p-2"
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-[11px] text-muted-foreground/70 px-3 text-center">
              <ImageIcon className="h-4 w-4" />
              <span>Upload a clown for {render.productSlug}</span>
            </div>
          )}
        </PipelineNode>

        <RowConnector
          active={refStatus === 'ready' && renderStatus !== 'draft'}
          traveling={isRendering}
        />

        {/* 02 — Recoloured render (the centerpiece) */}
        <PipelineNode
          label="Recolour"
          number="02"
          status={
            renderStatus === 'ready'
              ? 'ready'
              : renderStatus === 'rendering' || renderStatus === 'queued'
              ? 'active'
              : renderStatus === 'failed'
              ? 'failed'
              : 'pending'
          }
          empty={!render.renderUrl}
          minHeight="full"
        >
          {render.renderUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={render.renderUrl}
              alt={render.label}
              className="w-full h-full object-contain p-2"
            />
          ) : isRendering ? (
            <div className="absolute inset-0 cmf-rendering-shimmer flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-xs text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-medium">Rendering</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                  Nano Banana Pro
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Wand2 className="h-4 w-4" />
              <span>Awaiting render</span>
            </div>
          )}
        </PipelineNode>

        <RowConnector
          active={renderStatus === 'ready'}
          traveling={false}
        />

        {/* 03 — Spec / metadata */}
        <div className="flex flex-col justify-between p-3 rounded-xl bg-background/40 border border-border/40">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/70">
              <span className="font-mono">03</span>
              <span>Spec</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold tracking-tight leading-tight">
              {render.colorwayName ?? render.label}
            </h3>
            <p className="text-[11px] text-muted-foreground/80 font-mono uppercase tracking-wider mt-0.5">
              {render.productSlug}
              {render.productCode ? ` · ${render.productCode}` : ''}
            </p>
          </div>

          <ComponentChips render={render} />

          <div className="flex items-center justify-between gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-foreground transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Hide details
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Edit
                </>
              )}
            </button>
            <Button
              size="sm"
              onClick={handleRender}
              disabled={isRendering}
              className="h-7 gap-1.5 text-xs"
            >
              {isRendering ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : render.renderUrl ? (
                <RotateCw className="h-3 w-3" />
              ) : (
                <Wand2 className="h-3 w-3" />
              )}
              {render.renderUrl ? 'Re-render' : 'Render'}
            </Button>
          </div>
        </div>
      </div>

      {/* Inline error band — kept tight and contextual to the row */}
      {render.error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2.5 flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span className="leading-snug">{render.error}</span>
        </div>
      )}

      {/* Inline ready confirmation — only shown when no error so the row
          has one moment of positive feedback. */}
      {renderStatus === 'ready' && !render.error && (
        <div
          aria-hidden
          className="border-t border-primary/20 px-4 py-1.5 flex items-center gap-1.5 text-[11px] text-primary"
        >
          <CheckCircle2 className="h-3 w-3" />
          Render ready · {render.renderWidth}×{render.renderHeight}
        </div>
      )}

      {/* Editing details drawer */}
      {expanded && (
        <div className="border-t border-border/40 px-4 py-4 grid gap-3 sm:grid-cols-2">
          <Field label="Label">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-9"
            />
          </Field>
          <Field label="Colourway">
            <Input
              value={colorwayName}
              onChange={(e) => setColorwayName(e.target.value)}
              className="h-9"
            />
          </Field>
          <Field label="Product code">
            <Input
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              className="h-9 font-mono text-xs"
            />
          </Field>
          <Field label="Clown reference">
            <select
              value={clownAssetId ?? ''}
              onChange={(e) => setClownAssetId(e.target.value || null)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">
                {matchedClown ? `Auto · ${matchedClown.label}` : 'No clown uploaded yet'}
              </option>
              {(clowns ?? []).map((clown) => (
                <option key={clown.id} value={clown.id}>
                  {clown.label} · {clown.variantSlug}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={!dirty || updateMutation.isPending}
              className="gap-1.5"
            >
              {updateMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Save SKU
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}

/* ─── Sub-components ────────────────────────────────────────────────────── */

interface PipelineNodeProps {
  label: string
  number: string
  status: 'ready' | 'pending' | 'active' | 'failed'
  empty: boolean
  children: React.ReactNode
  minHeight?: 'full' | 'auto'
}

function PipelineNode({ label, number, status, empty, children, minHeight = 'auto' }: PipelineNodeProps) {
  return (
    <div
      className={cn(
        'relative aspect-square md:aspect-auto rounded-xl border overflow-hidden',
        'flex items-center justify-center',
        'bg-background/60',
        status === 'ready' && 'border-primary/30',
        status === 'active' && 'border-amber-400/40',
        status === 'failed' && 'border-destructive/40',
        status === 'pending' && 'border-border/40',
        minHeight === 'full' && 'min-h-[180px]'
      )}
    >
      <div className="absolute top-2 left-2 flex items-center gap-1 z-10 pointer-events-none">
        <span className="font-mono text-[9px] tracking-widest text-muted-foreground/60">
          {number}
        </span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
          {label}
        </span>
      </div>
      <div className={cn('w-full h-full flex items-center justify-center', empty && 'opacity-80')}>
        {children}
      </div>
    </div>
  )
}

function RowConnector({ active, traveling }: { active: boolean; traveling: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden md:flex items-center justify-center',
        traveling && 'cmf-connector-traveling'
      )}
    >
      <svg width="44" height="100%" viewBox="0 0 44 24" preserveAspectRatio="none">
        <line
          x1="0"
          y1="12"
          x2="44"
          y2="12"
          stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
          strokeOpacity={active ? '0.5' : '0.4'}
          strokeWidth="1.25"
          strokeDasharray={active && !traveling ? '0' : '3 3'}
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

function ComponentChips({ render }: { render: CmfRender }) {
  const chips = render.componentSpecs.slice(0, 6)
  return (
    <div className="flex flex-wrap gap-1 mt-3">
      {chips.map((spec) => (
        <span
          key={spec.region}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 pl-1 pr-2 py-0.5"
          title={`${spec.label}${spec.pantone ? ` · ${spec.pantone}` : ''}${spec.material ? ` · ${spec.material}` : ''}`}
        >
          <span
            className="h-3 w-3 rounded-full border border-border/60 flex-shrink-0"
            style={{ backgroundColor: spec.colorHex || 'hsl(var(--muted))' }}
          />
          <span className="text-[10px] font-medium leading-none">{spec.label}</span>
        </span>
      ))}
      {render.componentSpecs.length > chips.length && (
        <span className="inline-flex items-center text-[10px] text-muted-foreground/60 px-1">
          +{render.componentSpecs.length - chips.length}
        </span>
      )}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
        {label}
      </Label>
      {children}
    </div>
  )
}
