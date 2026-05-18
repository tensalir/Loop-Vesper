'use client'

import { useMemo } from 'react'
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useUpdatesList } from '@/hooks/useProductUpdates'
import type { ProductUpdate, UpdateSnippetTag } from '@/lib/updates/types'

const TAG_LABEL: Record<UpdateSnippetTag, string> = {
  new: 'New',
  improved: 'Improved',
  fix: 'Fix',
  note: 'Note',
}

const TAG_VARIANT: Record<UpdateSnippetTag, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  improved: 'secondary',
  fix: 'outline',
  note: 'outline',
}

const NEW_BADGE_WINDOW_DAYS = 7

function isWithinNewWindow(publishedAt: string): boolean {
  const published = new Date(publishedAt).getTime()
  const cutoff = Date.now() - NEW_BADGE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return published >= cutoff
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function groupByMonth(items: ProductUpdate[]): Array<{ label: string; items: ProductUpdate[] }> {
  const groups = new Map<string, ProductUpdate[]>()
  for (const item of items) {
    const date = new Date(item.publishedAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, items]) => {
      const [year, month] = key.split('-')
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
      return { label, items }
    })
}

function UpdateCard({ update }: { update: ProductUpdate }) {
  const showNewBadge = !update.seen && isWithinNewWindow(update.publishedAt)
  return (
    <Card
      id={update.slug}
      className={cn(
        'relative overflow-hidden transition-colors',
        update.seen ? 'opacity-90' : 'border-primary/30'
      )}
    >
      {!update.seen && (
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
      )}
      <CardContent className="pt-5 pb-5 pl-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold leading-tight">{update.title}</h3>
              {showNewBadge ? (
                <Badge className="text-[10px] uppercase tracking-wide">New</Badge>
              ) : null}
              {update.seen ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                  title="You have seen this update"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Read
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{formatDate(update.publishedAt)}</p>
          </div>
        </div>

        {update.summary ? (
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            {update.summary}
          </p>
        ) : null}

        {update.snippets.length > 0 && (
          <ul className="space-y-2">
            {update.snippets.map((snippet, idx) => (
              <li
                key={`${snippet.label}-${idx}`}
                className="rounded-md border border-border/50 bg-muted/20 p-3"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{snippet.label}</span>
                  {snippet.tag ? (
                    <Badge
                      variant={TAG_VARIANT[snippet.tag]}
                      className="text-[10px] uppercase tracking-wide"
                    >
                      {TAG_LABEL[snippet.tag]}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  {snippet.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export default function UpdatesPage() {
  const { data, isLoading, error } = useUpdatesList()

  const grouped = useMemo(() => {
    return data?.items ? groupByMonth(data.items) : []
  }, [data])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Updates</h1>
        </div>
        <p className="text-muted-foreground">
          What&apos;s new in Vesper — feature releases, improvements, and fixes,
          written for everyday use.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading updates...
        </div>
      )}

      {error && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Could not load updates right now. Please refresh and try again.
          </CardContent>
        </Card>
      )}

      {!isLoading && data && data.items.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">No updates yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Once we ship something worth sharing, it&apos;ll show up here.
            </p>
          </CardContent>
        </Card>
      )}

      {grouped.map((group) => (
        <section key={group.label} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          <div className="space-y-3">
            {group.items.map((update) => (
              <UpdateCard key={update.id} update={update} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
