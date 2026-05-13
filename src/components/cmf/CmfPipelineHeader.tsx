'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { CmfPacket } from '@/hooks/useCmf'
import {
  Check,
  ChevronDown,
  Loader2,
  Wand2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  LayoutTemplate,
  Library,
  Plus,
} from 'lucide-react'
import { listCmfProducts } from '@/lib/cmf/products'

/**
 * Horizontal CMF pipeline header.
 *
 * Six stages, matching the encoded `loop-cmf-generation` skill workflow:
 *   01 Schema · 02 References · 03 Generate · 04 Review · 05 Preview · 06 Export
 *
 * Each stage is a clickable card that exposes the data source / drawer for
 * that step (workbook import, clown library, bulk render, review gallery,
 * HTML preview, PDF export). Connectors between stages render as gradient
 * SVG paths that subtly animate when the upstream stage transitions to
 * "ready".
 */

export type StageKey =
  | 'import'
  | 'products'
  | 'generate'
  | 'review'
  | 'preview'
  | 'export'
export type StageStatus = 'pending' | 'active' | 'ready' | 'failed'

interface CmfPipelineHeaderProps {
  packet: CmfPacket | null
  /** Aggregate review readiness — approved / draft-only / missing per SKU. */
  readiness?: { total: number; approved: number; draftOnly: number; missing: number }
  /** Opens the unified import dialog (workbook + clown references in
   *  one place). Renders as a compact "+" button to the LEFT of the
   *  Products card — schema and references used to be separate stages
   *  but they're really the same preflight act. */
  onImportClick: () => void
  /** Opens the products library dialog — the "Products" stage at the
   *  start of the pipeline is the gate that decides which product
   *  you're working on. */
  onProductsClick: () => void
  onGenerateClick: () => void
  onReviewClick: () => void
  onPreviewClick: () => void
  onExportClick: () => void
}

interface Stage {
  key: StageKey
  number: string
  title: string
  hint: string
  meta: string
  status: StageStatus
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  /**
   * Optional label override for the `active` status badge. The default is
   * "Working", which is correct when a job is running. Stages where the
   * "active" state actually means "incomplete, waiting on input" override
   * this to a clearer copy (e.g. "Incomplete" for partial clown coverage).
   */
  activeLabel?: string
  /** When true, the stage card renders a small chevron-down indicator
   *  in the top-right corner instead of a status badge to communicate
   *  "this opens a picker, not an inline action". Used by the
   *  products gate. */
  isPicker?: boolean
  /** When true, the stage renders as a compact icon-only button
   *  instead of a full card. Used by the import "+" affordance to
   *  the left of the Products card so it sits visually as an action,
   *  not a step. */
  compact?: boolean
}

function deriveStages(args: CmfPipelineHeaderProps): Stage[] {
  const { packet, readiness } = args
  const renderCount = packet?.renders.length ?? 0
  const readyRenders = packet?.renders.filter((r) => r.status === 'ready').length ?? 0
  const renderingRenders =
    packet?.renders.filter((r) => r.status === 'rendering' || r.status === 'queued').length ?? 0
  const failedRenders = packet?.renders.filter((r) => r.status === 'failed').length ?? 0
  const totalAttempts =
    packet?.renders.reduce((sum, r) => sum + (r.renderAttempts?.length ?? 0), 0) ?? 0

  const generateStatus: StageStatus = !packet
    ? 'pending'
    : failedRenders > 0
    ? 'failed'
    : renderingRenders > 0
    ? 'active'
    : totalAttempts === 0
    ? 'pending'
    : 'ready'

  const reviewApproved = readiness?.approved ?? 0
  const reviewTotal = readiness?.total ?? renderCount
  const reviewStatus: StageStatus = !packet
    ? 'pending'
    : reviewTotal === 0
    ? 'pending'
    : reviewApproved === reviewTotal
    ? 'ready'
    : reviewApproved > 0
    ? 'active'
    : 'pending'

  const previewStatus: StageStatus = !packet
    ? 'pending'
    : reviewApproved > 0
    ? 'ready'
    : (readiness?.draftOnly ?? 0) > 0
    ? 'active'
    : 'pending'

  const exportStatus: StageStatus = !packet
    ? 'pending'
    : packet.pdfUrl
    ? 'ready'
    : packet.pdfError
    ? 'failed'
    : packet.status === 'rendering'
    ? 'active'
    : 'pending'

  // Products gate. Conceptually the entry: pick which product you're
  // working on. Resolves the active product's display name so the
  // meta line doubles as a breadcrumb.
  const activeSlug = packet?.renders?.[0]?.productSlug ?? null
  const activeProductName = activeSlug
    ? listCmfProducts().find((p) => p.slug === activeSlug)?.name?.replace(/^Loop\s+/, '') ?? activeSlug
    : null
  const productPacketCount = packet ? 1 : 0
  const productsStatus: StageStatus = packet ? 'ready' : 'pending'
  const productsMeta = packet
    ? `${activeProductName ?? 'Active product'} · ${productPacketCount} packet`
    : 'Pick a product to start'

  return [
    {
      key: 'import',
      number: '',
      title: 'Add',
      hint: '',
      meta: 'Drop a workbook (.xlsx) and the clown reference zips',
      // Always "ready" so the + button doesn't pretend to be a step
      // gated on prior progress — it's an action you can take any
      // time. The status colors only matter for full cards anyway.
      status: 'ready',
      icon: Plus,
      onClick: args.onImportClick,
      compact: true,
    },
    {
      key: 'products',
      number: '',
      title: 'Product',
      hint: '',
      meta: productsMeta,
      status: productsStatus,
      icon: Library,
      onClick: args.onProductsClick,
      isPicker: true,
    },
    {
      key: 'generate',
      number: '',
      title: 'Generate',
      hint: '',
      meta: !packet
        ? 'Awaiting product'
        : failedRenders > 0
        ? `${totalAttempts} attempts · ${failedRenders} failed`
        : renderingRenders > 0
        ? `${totalAttempts} attempts · ${renderingRenders} running`
        : totalAttempts === 0
        ? 'Run a bulk burst'
        : `${totalAttempts} ${totalAttempts === 1 ? 'attempt' : 'attempts'}`,
      status: generateStatus,
      icon: Wand2,
      onClick: args.onGenerateClick,
      disabled: !packet,
    },
    {
      key: 'review',
      number: '',
      title: 'Review',
      hint: '',
      meta: !packet
        ? 'Awaiting attempts'
        : reviewTotal === 0
        ? '—'
        : `${reviewApproved}/${reviewTotal} approved`,
      status: reviewStatus,
      activeLabel: 'Reviewing',
      icon: CheckCircle2,
      onClick: args.onReviewClick,
      disabled: !packet || totalAttempts === 0,
    },
    {
      key: 'preview',
      number: '',
      title: 'Preview',
      hint: '',
      meta: !packet
        ? 'Awaiting approvals'
        : reviewApproved === reviewTotal && reviewTotal > 0
        ? 'Layout ready'
        : reviewApproved > 0
        ? `${reviewApproved} of ${reviewTotal} ready`
        : 'Approve a SKU first',
      status: previewStatus,
      activeLabel: 'Draft only',
      icon: LayoutTemplate,
      onClick: args.onPreviewClick,
      disabled: !packet || readyRenders === 0,
    },
    {
      key: 'export',
      number: '',
      title: 'Export',
      hint: '',
      meta: !packet
        ? 'Awaiting renders'
        : packet.pdfUrl
        ? 'PDF ready'
        : packet.pdfError
        ? 'Export failed'
        : packet.status === 'rendering'
        ? 'Generating PDF…'
        : reviewApproved === 0
        ? 'Approve a SKU first'
        : reviewApproved < reviewTotal
        ? `${reviewApproved}/${reviewTotal} approved · draft`
        : 'Ready to export',
      status: exportStatus,
      icon: FileText,
      onClick: args.onExportClick,
      disabled: !packet || reviewApproved === 0,
    },
  ]
}

/* ─── Single stage card ─────────────────────────────────────────────────
 *
 * Larger format: number + icon header, title + hint, meta line, and
 * a status badge in the corner. Tighter than the very first version
 * (smaller padding, smaller icon block) but still readable at a glance
 * — the slim one-line chips lost too much information density.
 */

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const Icon = stage.icon
  const isReady = stage.status === 'ready'
  const isActive = stage.status === 'active'
  const isFailed = stage.status === 'failed'
  const isPending = stage.status === 'pending'

  // Compact "+" affordance — sits to the LEFT of the Product card as
  // the import action. Square button, icon only, dashed border so it
  // reads as "an entry door" rather than a step. Tooltip carries
  // the title + description.
  if (stage.compact) {
    return (
      <button
        type="button"
        onClick={stage.onClick}
        disabled={stage.disabled}
        title={`${stage.title} — ${stage.meta}`}
        className={cn(
          'group flex flex-shrink-0 items-center justify-center self-stretch',
          'aspect-square w-14 rounded-xl border border-dashed border-border/50',
          'bg-card/10 text-muted-foreground transition-colors duration-200',
          'hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-emerald-700 dark:hover:text-emerald-300',
          stage.disabled && 'cursor-not-allowed opacity-50 hover:border-border/50 hover:bg-card/10'
        )}
        data-stage={stage.key}
        aria-label={stage.title}
      >
        <Icon className="h-5 w-5" />
      </button>
    )
  }

  // Picker (Product) is the gate that determines everything
  // downstream — give it a distinct, always-on emerald treatment so
  // it doesn't read as just another step. A leading vertical bar
  // makes it visually heavier without making it taller.
  return (
    <button
      type="button"
      onClick={stage.onClick}
      disabled={stage.disabled}
      style={{ animationDelay: `${index * 70}ms` }}
      className={cn(
        'group relative flex-1 min-w-[170px] text-left overflow-hidden',
        'rounded-xl border p-4',
        'transition-colors duration-200',
        // Picker has its own dedicated visual key (Loop emerald,
        // always on) so it reads as the "you start here" gate.
        stage.isPicker
          ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/[0.08] to-emerald-500/[0.02] hover:border-emerald-500/60 hover:from-emerald-500/[0.12]'
          : [
              isReady && 'border-emerald-500/25 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]',
              isActive && 'border-amber-500/30 bg-amber-500/[0.05] hover:bg-amber-500/[0.09]',
              isFailed && 'border-destructive/30 bg-destructive/[0.05] hover:bg-destructive/[0.09]',
              isPending && 'border-border/40 bg-card/20 hover:border-border/70 hover:bg-card/40',
            ],
        stage.disabled && 'cursor-not-allowed opacity-50 hover:bg-card/20 hover:border-border/40',
        'cmf-stage-enter'
      )}
      data-stage={stage.key}
      data-status={stage.status}
    >
      {/* Picker gets a leading vertical accent bar — adds visual
          weight without making the card taller than its peers. */}
      {stage.isPicker && (
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-emerald-500/70"
        />
      )}

      {/* Top row: icon + tone dot. No number, no eyebrow, no badge. */}
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            'h-4 w-4 flex-shrink-0',
            stage.isPicker
              ? 'text-emerald-600 dark:text-emerald-400'
              : isReady
              ? 'text-emerald-600 dark:text-emerald-400'
              : isActive
              ? 'text-amber-600 dark:text-amber-400'
              : isFailed
              ? 'text-destructive'
              : 'text-muted-foreground/60'
          )}
        />
        {isActive && !stage.isPicker && (
          <Loader2 className="h-3 w-3 animate-spin text-amber-600 dark:text-amber-400" />
        )}
        {/* Picker eyebrow that names this card as the start of the
            flow. Tiny, all-caps; doesn't compete with the title. */}
        {stage.isPicker && (
          <span className="ml-auto text-[9px] font-medium uppercase tracking-[0.18em] text-emerald-700/70 dark:text-emerald-400/70">
            Start here
          </span>
        )}
      </div>

      {/* Title — picker chevron tucked next to it for the Product card. */}
      <h3 className="mt-3 text-sm font-semibold tracking-tight leading-tight inline-flex items-center gap-1">
        {stage.title}
        {stage.isPicker && (
          <ChevronDown className="h-3 w-3 opacity-60 transition-transform group-hover:translate-y-0.5" />
        )}
      </h3>

      {/* Meta — the single piece of state-bearing copy on the card. */}
      <p
        className={cn(
          'mt-1.5 text-[11px] leading-snug',
          stage.isPicker
            ? 'text-emerald-700/80 dark:text-emerald-300/80'
            : 'text-muted-foreground'
        )}
      >
        {stage.meta}
      </p>
    </button>
  )
}

function StatusDot({
  status,
  activeLabel,
}: {
  status: StageStatus
  activeLabel?: string
}) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-primary">
        <Check className="h-3 w-3" />
        Ready
      </span>
    )
  }
  if (status === 'active') {
    const label = activeLabel ?? 'Working'
    const isWorking = label === 'Working'
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-300">
        {isWorking ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        )}
        {label}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-destructive">
        <AlertTriangle className="h-3 w-3" />
        Issue
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Pending
    </span>
  )
}

/* ─── Connector between stages ──────────────────────────────────────────── */

function StageConnector({ from, to }: { from: StageStatus; to: StageStatus }) {
  // The connector "lights up" when the upstream stage is ready and
  // the downstream has work going. Slim and quiet — the cards do
  // most of the talking.
  const lit = (from === 'ready' || from === 'active') && to !== 'pending'

  return (
    <div
      className="hidden md:flex flex-shrink-0 items-center -mx-1"
      aria-hidden
    >
      <svg width="20" height="32" viewBox="0 0 20 32" className="overflow-visible">
        <line
          x1="2"
          y1="16"
          x2="18"
          y2="16"
          stroke={
            lit
              ? 'color-mix(in oklch, hsl(var(--primary)) 55%, transparent)'
              : 'color-mix(in oklch, hsl(var(--border)) 55%, transparent)'
          }
          strokeWidth="1"
          strokeDasharray={lit ? '0' : '2 3'}
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

/* ─── Public component ──────────────────────────────────────────────────── */

export function CmfPipelineHeader(props: CmfPipelineHeaderProps) {
  const stages = useMemo(() => deriveStages(props), [props])

  return (
    <section
      aria-label="CMF pipeline"
      // Outer wrapper kept intentionally light: no border, no bg,
      // no radial wash. The cards already carry their own borders;
      // wrapping them in another bordered box was double-chroming.
      // Spacing does the grouping work instead.
      className="-mx-1 px-1"
    >
      <div className="flex items-stretch gap-3 md:gap-4 overflow-x-auto md:overflow-visible">
        {stages.map((stage, idx) => {
          const next = stages[idx + 1]
          // No connector after the compact "+" button (it's an
          // action, not a step in the flow), and we want extra
          // breathing room between the + and the Product card so
          // they don't read as crammed.
          const showConnector = next && !stage.compact
          return (
            <div
              key={stage.key}
              className={cn(
                'flex items-stretch min-w-0',
                // Push the next card away when this one is the
                // compact "+" — gives the action button room to
                // breathe without inheriting the step rhythm.
                stage.compact && 'mr-1'
              )}
            >
              <StageCard stage={stage} index={idx} />
              {showConnector && (
                <StageConnector from={stage.status} to={next.status} />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
