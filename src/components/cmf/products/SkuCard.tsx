'use client'

/**
 * Single SKU card inside the Workbook tab.
 *
 * Left: thumbnail of the approved render (or a placeholder when
 * nothing's been approved yet). Right: label, productCode, components
 * grid (region · material · finish · pantone · hex with a small color
 * swatch), and an optional palette swatch row.
 *
 * The point is "double-check what was imported" — this is the only
 * surface in the app that shows the parsed components + palette
 * without dropping the designer back into the spreadsheet.
 */

import { ImageOff } from 'lucide-react'
import type { ProductSummary } from '@/lib/cmf/product-summary'
import { getComponentLabel } from '@/lib/cmf/products'

interface SkuCardProps {
  render: ProductSummary['packets'][number]['renders'][number]
  productSlug: string
}

export function SkuCard({ render, productSlug }: SkuCardProps) {
  const components = (render.componentSpecs ?? []) as Array<{
    region: string
    label?: string
    material?: string | null
    finish?: string | null
    pantone?: string | null
    colorHex?: string | null
    technique?: string | null
    notes?: string | null
  }>
  const palette = (render.paletteSwatches ?? []) as Array<{
    label: string
    pantone?: string | null
    colorHex?: string | null
  }>
  return (
    <div className="flex gap-4 items-start">
      <div className="flex-shrink-0 h-16 w-16 rounded-md border border-border/40 bg-background/60 overflow-hidden flex items-center justify-center">
        {render.renderUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={render.renderUrl}
            alt={render.label ?? ''}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold truncate">
              {render.colorwayName ?? render.label}
            </h4>
            <p className="text-[10px] font-mono text-muted-foreground/80 truncate">
              {render.productCode || '—'}
              {render.ean && (
                <>
                  <span className="mx-1.5 opacity-50">·</span>
                  EAN {render.ean}
                </>
              )}
            </p>
          </div>
          {render.status && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 flex-shrink-0">
              {render.status}
            </span>
          )}
        </div>

        {components.length > 0 && (
          <div className="rounded-md border border-border/30 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  <th className="px-2.5 py-1.5 text-left font-medium">Region</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">Material / Finish</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">Pantone</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">Hex</th>
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => {
                  const label = c.label ?? getComponentLabel(productSlug, c.region)
                  return (
                    <tr
                      key={`${c.region}-${i}`}
                      className="border-t border-border/30 hover:bg-muted/10"
                    >
                      <td className="px-2.5 py-1.5 font-medium truncate max-w-[180px]">
                        {label}
                      </td>
                      <td className="px-2.5 py-1.5 text-muted-foreground truncate max-w-[200px]">
                        {[c.material, c.finish].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-muted-foreground">
                        {c.pantone || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono">
                        {c.colorHex ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="h-2.5 w-2.5 rounded-full border border-border/40"
                              style={{ backgroundColor: c.colorHex }}
                            />
                            {c.colorHex}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {palette.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-muted-foreground">
            <span className="uppercase tracking-wider opacity-60">Palette</span>
            {palette.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/40 px-1.5 py-0.5"
                title={[s.label, s.pantone, s.colorHex].filter(Boolean).join(' · ')}
              >
                {s.colorHex && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full border border-border/40"
                    style={{ backgroundColor: s.colorHex }}
                  />
                )}
                <span className="font-medium text-foreground/80">{s.label}</span>
                {s.pantone && <span className="font-mono opacity-70">{s.pantone}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
