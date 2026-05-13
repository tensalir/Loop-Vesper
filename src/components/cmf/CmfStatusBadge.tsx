'use client'

/**
 * Shared status-tone primitives for CMF surfaces.
 *
 * Two flavours of "tone" coexisted as inline `cn(...)` ternaries across
 * the workspace, products dialog, attempt gallery, pipeline header, and
 * preview dialog:
 *
 *   - **Coverage tones** (library / product readiness): `ready`,
 *     `partial`, `blocked`, `empty`. Used by the products library rail
 *     and the per-product header pill.
 *   - **Lifecycle tones** (packet / render state machine): `ready`,
 *     `rendering`, `failed`, `draft`. Used by the per-packet status
 *     badge in the workbook tab and on render rows.
 *
 * `ready` is a deliberate overlap — both vocabularies converge on
 * emerald when something is "done / good". `partial` and `rendering`
 * both use amber but carry different semantics (partial = mixed
 * coverage; rendering = work in progress); kept distinct so future
 * style changes can diverge without regressing one or the other.
 *
 * The exported helpers are intentionally lightweight: a className map
 * plus two micro-components (`CmfStatusDot`, `CmfStatusBadge`). Callers
 * that need a non-standard layout can compose `cmfToneClasses` directly
 * — the purpose is to centralise the colour vocabulary, not to lock
 * every consumer into one markup shape.
 */

import { cn } from '@/lib/utils'

export type CmfStatusTone =
  | 'ready'
  | 'partial'
  | 'blocked'
  | 'empty'
  | 'rendering'
  | 'failed'
  | 'draft'

interface ToneStyle {
  /** Solid colour for the dot variant. */
  dot: string
  /** Background + foreground for the pill variant. */
  pill: string
}

/**
 * Single source of truth for CMF status colours. Add a tone here and the
 * primitives + every consumer pick it up automatically.
 */
const TONE_CLASSES: Record<CmfStatusTone, ToneStyle> = {
  ready: {
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  partial: {
    dot: 'bg-amber-500',
    pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  rendering: {
    dot: 'bg-amber-500',
    pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-200',
  },
  blocked: {
    dot: 'bg-rose-500',
    pill: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
  failed: {
    dot: 'bg-destructive',
    pill: 'bg-destructive/15 text-destructive',
  },
  empty: {
    dot: 'bg-muted-foreground/30',
    pill: 'bg-muted/30 text-muted-foreground',
  },
  draft: {
    dot: 'bg-muted-foreground/40',
    pill: 'bg-muted text-muted-foreground',
  },
}

export function cmfToneClasses(tone: CmfStatusTone): ToneStyle {
  return TONE_CLASSES[tone]
}

/**
 * Tiny coloured circle. Used by the products library rail to indicate
 * coverage state next to a product name, and by the badge primitive
 * itself when it renders the dot+label layout.
 */
export function CmfStatusDot({
  tone,
  size = 'md',
  className,
}: {
  tone: CmfStatusTone
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'rounded-full flex-shrink-0',
        size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
        TONE_CLASSES[tone].dot,
        className
      )}
    />
  )
}

/**
 * Pill badge with dot + label. Used by the per-product header
 * ("Ready" / "Partial" / "Needs clowns" / "Empty") and by the per-packet
 * status badge in the workbook tab ("ready" / "rendering" / "failed" /
 * "draft").
 *
 * Caller controls the label so the same tone can mean different things
 * in different contexts (e.g. "Ready" vs "ready" vs "Done"); no
 * built-in label dictionary because that locks language.
 */
export function CmfStatusBadge({
  tone,
  label,
  className,
}: {
  tone: CmfStatusTone
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        TONE_CLASSES[tone].pill,
        className
      )}
    >
      <CmfStatusDot tone={tone} size="sm" />
      {label}
    </span>
  )
}
