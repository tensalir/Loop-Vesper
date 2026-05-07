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
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface CmfRenderRowProps {
  render: CmfRender
  packetId: string
}

export function CmfRenderRow({ render, packetId }: CmfRenderRowProps) {
  const { data: clowns } = useCmfClowns(render.productSlug)
  const updateMutation = useUpdateCmfRender()
  const generateMutation = useGenerateCmfRender()
  const { toast } = useToast()

  const [label, setLabel] = useState(render.label)
  const [colorwayName, setColorwayName] = useState(render.colorwayName ?? '')
  const [productCode, setProductCode] = useState(render.productCode ?? '')
  const [clownAssetId, setClownAssetId] = useState<string | null>(
    render.clownAssetId
  )

  const dirty = useMemo(() => {
    return (
      label !== render.label ||
      colorwayName !== (render.colorwayName ?? '') ||
      productCode !== (render.productCode ?? '') ||
      clownAssetId !== render.clownAssetId
    )
  }, [label, colorwayName, productCode, clownAssetId, render])

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
      await generateMutation.mutateAsync({
        renderId: render.id,
        packetId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Render failed'
      toast({ title: `Render failed: ${render.label}`, description: message })
    }
  }

  const hasMatchingClown = (clowns ?? []).some(
    (c) => c.productSlug === render.productSlug
  )
  const isRendering = generateMutation.isPending || render.status === 'rendering'

  return (
    <div
      className={cn(
        'rounded-xl border bg-card/40 p-5 transition-colors',
        render.status === 'ready'
          ? 'border-emerald-500/40'
          : render.status === 'failed'
          ? 'border-destructive/40'
          : 'border-border/60'
      )}
    >
      <div className="grid gap-5 md:grid-cols-[200px_1fr_auto]">
        <div className="aspect-square rounded-lg bg-background/60 border border-border/60 overflow-hidden flex items-center justify-center text-muted-foreground">
          {render.renderUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={render.renderUrl}
              alt={render.label}
              className="w-full h-full object-contain"
            />
          ) : isRendering ? (
            <div className="flex flex-col items-center gap-1.5 text-xs">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Rendering…</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-xs">
              <ImageIcon className="h-5 w-5" />
              <span>No render yet</span>
            </div>
          )}
        </div>

        <div className="space-y-3 min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Label
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Colourway
              </Label>
              <Input
                value={colorwayName}
                onChange={(e) => setColorwayName(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Product code
              </Label>
              <Input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Clown reference
              </Label>
              <select
                value={clownAssetId ?? ''}
                onChange={(e) => setClownAssetId(e.target.value || null)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {hasMatchingClown ? 'Auto (first match)' : 'No clown uploaded yet'}
                </option>
                {(clowns ?? []).map((clown) => (
                  <option key={clown.id} value={clown.id}>
                    {clown.label} · {clown.variantSlug}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Components
            </Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {render.componentSpecs.map((spec) => (
                <div
                  key={spec.region}
                  className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-2"
                >
                  <div
                    className="h-6 w-6 rounded border border-border/40 flex-shrink-0"
                    style={{ backgroundColor: spec.colorHex || '#444' }}
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-medium truncate">{spec.label}</p>
                    <p className="text-muted-foreground truncate">
                      {spec.pantone || spec.colorHex || 'no colour'}
                      {spec.material ? ` · ${spec.material}` : ''}
                      {spec.finish ? ` · ${spec.finish}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {render.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{render.error}</span>
            </div>
          )}

          {render.status === 'ready' && !render.error && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Render ready
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            {render.productSlug}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!dirty || updateMutation.isPending}
              className="gap-1.5"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save
            </Button>
            <Button
              size="sm"
              onClick={handleRender}
              disabled={isRendering}
              className="gap-1.5"
            >
              {isRendering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : render.renderUrl ? (
                <RotateCw className="h-3.5 w-3.5" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {render.renderUrl ? 'Re-render' : 'Render'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
