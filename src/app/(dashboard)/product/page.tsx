'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowRight, Palette, Sparkles } from 'lucide-react'

interface ProductTool {
  slug: string
  name: string
  description: string
  href: string
  status: 'live' | 'soon'
  icon: React.ComponentType<{ className?: string }>
}

const TOOLS: ProductTool[] = [
  {
    slug: 'cmf',
    name: 'CMF Studio',
    description:
      'Import a SKU schema, generate photorealistic colourway renders with Vesper, and export a CMF spec PDF. Single source of truth from a workbook to a packet.',
    href: '/product/cmf',
    status: 'live',
    icon: Palette,
  },
  {
    slug: 'use-cases',
    name: 'More designer tools',
    description:
      'This is the home for product-designer workflows that turn a single source of truth into render-ready assets. New use cases will land here next.',
    href: '/product',
    status: 'soon',
    icon: Sparkles,
  },
]

export default function ProductHub() {
  return (
    <div className="space-y-10 max-w-6xl mx-auto">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Product Designers
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Studio for product workflows
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          A small constellation of workflows for the product team. Each one
          collapses a slow manual loop — schema-to-deck, ref-collection, spec
          PDFs — into a single import + render + export.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon
          const cardBody = (
            <Card
              className={
                tool.status === 'live'
                  ? 'h-full transition-all border-border/60 hover:border-primary/60 hover:-translate-y-[1px] hover:shadow-md'
                  : 'h-full border-dashed'
              }
            >
              <CardContent className="p-6 flex flex-col gap-4 h-full">
                <div className="flex items-start justify-between">
                  <div className="rounded-md bg-primary/10 text-primary p-2.5">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span
                    className={
                      tool.status === 'live'
                        ? 'text-[10px] font-semibold uppercase tracking-wider text-primary'
                        : 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'
                    }
                  >
                    {tool.status === 'live' ? 'Live' : 'Soon'}
                  </span>
                </div>

                <div className="space-y-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {tool.name}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {tool.description}
                  </p>
                </div>

                {tool.status === 'live' && (
                  <div className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                    Open
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
              </CardContent>
            </Card>
          )
          if (tool.status === 'live') {
            return (
              <Link key={tool.slug} href={tool.href} className="group block">
                {cardBody}
              </Link>
            )
          }
          return (
            <div
              key={tool.slug}
              aria-disabled
              className="block opacity-60 cursor-default"
            >
              {cardBody}
            </div>
          )
        })}
      </div>
    </div>
  )
}
