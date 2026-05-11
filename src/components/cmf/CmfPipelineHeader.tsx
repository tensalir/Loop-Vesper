'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { CmfPacket } from '@/hooks/useCmf'
import {
  Check,
  Loader2,
  Database,
  Image as ImageIcon,
  Wand2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  LayoutTemplate,
} from 'lucide-react'

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
  | 'schema'
  | 'references'
  | 'generate'
  | 'review'
  | 'preview'
  | 'export'
export type StageStatus = 'pending' | 'active' | 'ready' | 'failed'

interface CmfPipelineHeaderProps {
  packet: CmfPacket | null
  /** Counts derived elsewhere (clowns / pending-rows etc.) */
  clownCoverage?: { matched: number; total: number }
  importErrorCount?: number
  /** Aggregate review readiness — approved / draft-only / missing per SKU. */
  readiness?: { total: number; approved: number; draftOnly: number; missing: number }
  onSchemaClick: () => void
  onReferencesClick: () => void
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
}

function deriveStages(args: {
  packet: CmfPacket | null
  clownCoverage?: { matched: number; total: number }
  importErrorCount?: number
  readiness?: { total: number; approved: number; draftOnly: number; missing: number }
  onSchemaClick: () => void
  onReferencesClick: () => void
  onGenerateClick: () => void
  onReviewClick: () => void
  onPreviewClick: () => void
  onExportClick: () => void
}): Stage[] {
  const { packet, clownCoverage, importErrorCount = 0, readiness } = args
  const renderCount = packet?.renders.length ?? 0
  const readyRenders = packet?.renders.filter((r) => r.status === 'ready').length ?? 0
  const renderingRenders =
    packet?.renders.filter((r) => r.status === 'rendering' || r.status === 'queued').length ?? 0
  const failedRenders = packet?.renders.filter((r) => r.status === 'failed').length ?? 0
  const totalAttempts =
    packet?.renders.reduce((sum, r) => sum + (r.renderAttempts?.length ?? 0), 0) ?? 0

  const schemaStatus: StageStatus = !packet
    ? 'pending'
    : importErrorCount > 0
    ? 'failed'
    : 'ready'

  const referencesStatus: StageStatus = !packet
    ? 'pending'
    : !clownCoverage || clownCoverage.total === 0
    ? 'pending'
    : clownCoverage.matched === clownCoverage.total
    ? 'ready'
    : 'active'

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

  return [
    {
      key: 'schema',
      number: '01',
      title: 'Schema',
      hint: 'Workbook in',
      meta: !packet
        ? 'No workbook imported yet'
        : importErrorCount > 0
        ? `${renderCount} rows · ${importErrorCount} errors`
        : `${renderCount} ${renderCount === 1 ? 'SKU' : 'SKUs'} parsed`,
      status: schemaStatus,
      icon: Database,
      onClick: args.onSchemaClick,
    },
    {
      key: 'references',
      number: '02',
      title: 'References',
      hint: 'Clown library',
      meta: !packet
        ? 'Awaiting workbook'
        : !clownCoverage
        ? 'Resolving clown coverage…'
        : clownCoverage.matched === clownCoverage.total
        ? `${clownCoverage.matched}/${clownCoverage.total} matched`
        : `${clownCoverage.matched}/${clownCoverage.total} matched · ${clownCoverage.total - clownCoverage.matched} need clowns`,
      status: referencesStatus,
      activeLabel: 'Incomplete',
      icon: ImageIcon,
      onClick: args.onReferencesClick,
      disabled: !packet,
    },
    {
      key: 'generate',
      number: '03',
      title: 'Generate',
      hint: 'Nano Banana bulk',
      meta: !packet
        ? 'Awaiting workbook'
        : failedRenders > 0
        ? `${totalAttempts} attempts · ${failedRenders} failed`
        : renderingRenders > 0
        ? `${totalAttempts} attempts · ${renderingRenders} running`
        : totalAttempts === 0
        ? 'Run a burst across all SKUs'
        : `${totalAttempts} ${totalAttempts === 1 ? 'attempt' : 'attempts'}`,
      status: generateStatus,
      icon: Wand2,
      onClick: args.onGenerateClick,
      disabled: !packet,
    },
    {
      key: 'review',
      number: '04',
      title: 'Review',
      hint: 'Approve / archive',
      meta: !packet
        ? 'Awaiting attempts'
        : reviewTotal === 0
        ? '—'
        : `${reviewApproved}/${reviewTotal} approved${
            (readiness?.missing ?? 0) > 0 ? ` · ${readiness?.missing} missing` : ''
          }`,
      status: reviewStatus,
      activeLabel: 'Reviewing',
      icon: CheckCircle2,
      onClick: args.onReviewClick,
      disabled: !packet || totalAttempts === 0,
    },
    {
      key: 'preview',
      number: '05',
      title: 'Preview',
      hint: 'HTML layout',
      meta: !packet
        ? 'Awaiting approvals'
        : reviewApproved === reviewTotal && reviewTotal > 0
        ? 'Layout ready · click to open'
        : reviewApproved > 0
        ? `${reviewApproved} ready · ${reviewTotal - reviewApproved} pending`
        : 'Approve a SKU first',
      status: previewStatus,
      activeLabel: 'Draft only',
      icon: LayoutTemplate,
      onClick: args.onPreviewClick,
      disabled: !packet || readyRenders === 0,
    },
    {
      key: 'export',
      number: '06',
      title: 'Export',
      hint: 'Packet PDF',
      meta: !packet
        ? 'Awaiting renders'
        : packet.pdfUrl
        ? 'PDF ready · click to open'
        : packet.pdfError
        ? 'Export failed'
        : packet.status === 'rendering'
        ? 'Generating PDF…'
        : reviewApproved === 0
        ? 'Approve a SKU first'
        : reviewApproved < reviewTotal
        ? `${reviewApproved}/${reviewTotal} approved · DRAFT export available`
        : 'Ready to export',
      status: exportStatus,
      icon: FileText,
      onClick: args.onExportClick,
      disabled: !packet || reviewApproved === 0,
    },
  ]
}

/* ─── Single stage card ─────────────────────────────────────────────────── */

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const Icon = stage.icon
  const isReady = stage.status === 'ready'
  const isActive = stage.status === 'active'
  const isFailed = stage.status === 'failed'
  const isPending = stage.status === 'pending'

  return (
    <button
      type="button"
      onClick={stage.onClick}
      disabled={stage.disabled}
      style={{
        animationDelay: `${index * 70}ms`,
        ...(isReady || isActive
          ? {
              backgroundColor:
                'color-mix(in oklch, hsl(var(--primary)) 6%, hsl(var(--card) / 0.4))',
              borderColor:
                'color-mix(in oklch, hsl(var(--primary)) 30%, hsl(var(--border) / 0.5))',
            }
          : isFailed
          ? {
              backgroundColor:
                'color-mix(in oklch, hsl(var(--destructive)) 6%, hsl(var(--card) / 0.4))',
              borderColor:
                'color-mix(in oklch, hsl(var(--destructive)) 30%, hsl(var(--border) / 0.5))',
            }
          : {}),
      }}
      className={cn(
        'group relative flex-1 min-w-[200px] text-left',
        'rounded-xl border p-4 md:p-5',
        'transition-all duration-300 ease-out',
        'border-border/50 bg-card/30',
        'hover:bg-card/60 hover:border-border/80',
        stage.disabled && 'cursor-not-allowed opacity-60 hover:bg-card/30 hover:border-border/50',
        'cmf-stage-enter'
      )}
      data-stage={stage.key}
      data-status={stage.status}
    >
      {/* Top row: number + icon + status pulse */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] font-medium tracking-widest text-muted-foreground/60">
            {stage.number}
          </span>
          <span
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              isReady && 'text-primary',
              isActive && 'text-primary',
              isFailed && 'text-destructive',
              isPending && 'text-muted-foreground/70'
            )}
            style={
              isReady || isActive
                ? {
                    backgroundColor:
                      'color-mix(in oklch, hsl(var(--primary)) 14%, transparent)',
                  }
                : isFailed
                ? {
                    backgroundColor:
                      'color-mix(in oklch, hsl(var(--destructive)) 14%, transparent)',
                  }
                : undefined
            }
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <StatusDot status={stage.status} activeLabel={stage.activeLabel} />
      </div>

      {/* Title + hint */}
      <div className="mt-3 space-y-0.5">
        <h3 className="text-base font-semibold tracking-tight leading-tight">
          {stage.title}
        </h3>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
          {stage.hint}
        </p>
      </div>

      {/* Meta line: small but informative */}
      <p
        className={cn(
          'mt-3 text-[12px] leading-snug',
          isReady && 'text-primary/90',
          isActive && 'text-amber-600 dark:text-amber-300',
          isFailed && 'text-destructive',
          isPending && 'text-muted-foreground/70'
        )}
      >
        {stage.meta}
      </p>

      {/* Bottom hairline that lights up on hover */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-4 bottom-3 h-px transition-colors',
          isReady ? 'bg-primary/40' : isActive ? 'bg-amber-400/40' : 'bg-border/30'
        )}
      />
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
    // Default to a spinner + "Working". When the active state actually
    // represents "incomplete, waiting on input" the caller can override
    // the label and we drop the spinner so the badge stops implying a
    // background job is in flight.
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
  // The connector "lights up" when the upstream stage is ready and the
  // downstream is at least active. This gives a subtle data-flow cue.
  const lit = (from === 'ready' || from === 'active') && to !== 'pending'

  return (
    <div className="hidden md:flex flex-shrink-0 items-center px-1" aria-hidden>
      <svg width="44" height="36" viewBox="0 0 44 36" className="overflow-visible">
        <defs>
          <linearGradient id="cmfConnectorLit" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="cmfConnectorIdle" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--border))" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(var(--border))" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {/* Dotted base line — always present */}
        <line
          x1="2"
          y1="18"
          x2="42"
          y2="18"
          stroke={lit ? 'url(#cmfConnectorLit)' : 'url(#cmfConnectorIdle)'}
          strokeWidth="1.25"
          strokeDasharray={lit ? '0' : '2 3'}
          strokeLinecap="round"
        />
        {/* Direction caret */}
        <path
          d={`M 36 14 L 42 18 L 36 22`}
          fill="none"
          stroke={lit ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeOpacity={lit ? '0.7' : '0.5'}
        />
        {/* Animated traveler dot when the connector is lit */}
        {lit && (
          <circle r="1.5" fill="hsl(var(--primary))">
            <animateMotion
              dur="2.4s"
              repeatCount="indefinite"
              path="M 4 18 L 40 18"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
        )}
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
      className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm p-4 md:p-5"
      style={{
        backgroundImage:
          'radial-gradient(60% 90% at 0% 0%, color-mix(in oklch, hsl(var(--primary)) 8%, transparent), transparent 60%)',
      }}
    >
      <div className="flex items-stretch gap-2 overflow-x-auto md:overflow-visible -mx-1 px-1 pb-1">
        {stages.map((stage, idx) => (
          <div key={stage.key} className="flex items-stretch min-w-0">
            <StageCard stage={stage} index={idx} />
            {idx < stages.length - 1 && (
              <StageConnector from={stage.status} to={stages[idx + 1].status} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
