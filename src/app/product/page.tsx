'use client'

import Link from 'next/link'
import { ArrowRight, Palette, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * /product hub. The product-designer constellation lives here. Each tool
 * collapses a slow manual workflow into an import + render + export.
 *
 * Aesthetic: full-bleed canvas with one quiet atmosphere wash (set in the
 * chrome layout). The hub itself is intentionally restrained — the
 * pipeline inside each tool is the centerpiece, not the launcher.
 */

interface ProductTool {
  slug: string
  name: string
  description: string
  href: string
  status: 'live' | 'soon'
  icon: React.ComponentType<{ className?: string }>
  /** A one-line preview of the pipeline shape so the hub previews the
   *  experience without committing to an icon-grid card template. */
  pipeline?: string[]
}

const TOOLS: ProductTool[] = [
  {
    slug: 'cmf',
    name: 'CMF Studio',
    description:
      'Workbook → resolved clown refs → photoreal SKU renders → packet PDF. One pipeline, one source of truth, every colourway through Vesper.',
    href: '/product/cmf',
    status: 'live',
    icon: Palette,
    pipeline: ['Schema', 'References', 'Render', 'Export'],
  },
  {
    slug: 'soon',
    name: 'More designer tools',
    description:
      'Upcoming pipelines for the product team. Tell us what slow loop you want collapsed next and it lands here.',
    href: '/product',
    status: 'soon',
    icon: Sparkles,
    pipeline: ['Brief', 'Generate', 'Review', 'Ship'],
  },
]

export default function ProductHub() {
  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <header className="space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          Loop · Product Designers
        </p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Pipelines for product workflows
        </h1>
        <p className="text-base text-muted-foreground max-w-2xl leading-relaxed">
          Each tool collapses a slow loop into a single, traceable pipeline:
          schema in, packet out, every step visible.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon
          const isLive = tool.status === 'live'
          const body = (
            <article
              className={cn(
                'group relative h-full rounded-2xl border p-6 md:p-8',
                'transition-all duration-300 ease-out',
                isLive
                  ? 'border-border/60 bg-card/40 hover:border-primary/50 hover:bg-card/60 hover:-translate-y-[2px]'
                  : 'border-dashed border-border/40 bg-card/20'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'rounded-lg p-2.5',
                      isLive
                        ? 'bg-primary/12 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                    style={
                      isLive
                        ? {
                            backgroundColor:
                              'color-mix(in oklch, hsl(var(--primary)) 12%, transparent)',
                          }
                        : undefined
                    }
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight leading-tight">
                      {tool.name}
                    </h2>
                  </div>
                </div>
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-[0.2em]',
                    isLive ? 'text-primary' : 'text-muted-foreground/60'
                  )}
                >
                  {isLive ? 'Live' : 'Soon'}
                </span>
              </div>

              <p className="mt-5 text-sm text-muted-foreground leading-relaxed">
                {tool.description}
              </p>

              {tool.pipeline && (
                <div className="mt-6 flex items-center gap-2 flex-wrap">
                  {tool.pipeline.map((stage, idx) => (
                    <div key={stage} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
                          'text-[10px] font-medium uppercase tracking-wider',
                          'border',
                          isLive
                            ? 'border-primary/30 text-primary/90'
                            : 'border-border/50 text-muted-foreground/70'
                        )}
                        style={
                          isLive
                            ? {
                                backgroundColor:
                                  'color-mix(in oklch, hsl(var(--primary)) 8%, transparent)',
                              }
                            : undefined
                        }
                      >
                        <span className="font-mono text-[9px] opacity-60">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        {stage}
                      </span>
                      {idx < tool.pipeline!.length - 1 && (
                        <span
                          aria-hidden
                          className={cn(
                            'h-px w-4 transition-colors',
                            isLive ? 'bg-primary/30' : 'bg-border/40'
                          )}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isLive && (
                <div className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:gap-3 transition-all">
                  Open studio
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </article>
          )

          if (isLive) {
            return (
              <Link key={tool.slug} href={tool.href} className="block">
                {body}
              </Link>
            )
          }
          return (
            <div
              key={tool.slug}
              aria-disabled
              className="block opacity-60 cursor-default"
            >
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
