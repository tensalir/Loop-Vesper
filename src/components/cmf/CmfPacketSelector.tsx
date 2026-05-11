'use client'

import { useMemo, useState } from 'react'
import { useCmfClowns, useCmfPackets, type CmfPacket } from '@/hooks/useCmf'
import {
  clownCoverageForPacket,
  summariseWorkspaceCoverage,
} from '@/lib/cmf/coverage'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react'

interface CmfPacketSelectorProps {
  activePacketId: string | null
  onSelect: (id: string) => void
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed',
}

type ReadinessTone = 'ready' | 'partial' | 'blocked' | 'empty'

function packetTone(packet: CmfPacket, clowns: ReturnType<typeof useCmfClowns>['data']): ReadinessTone {
  if (!packet.renders || packet.renders.length === 0) return 'empty'
  const c = clownCoverageForPacket(packet, clowns ?? null)
  if (c.blocked === 0) return 'ready'
  if (c.matched > 0) return 'partial'
  return 'blocked'
}

/**
 * Compact packet selector used as the workspace's left-hand identifier.
 * Designed to feel like the project switcher in /projects/[id] — small
 * pill, click-to-open dropdown, never steals attention from the pipeline.
 */
export function CmfPacketSelector({ activePacketId, onSelect }: CmfPacketSelectorProps) {
  const { data: packets, isLoading } = useCmfPackets()
  const { data: clowns } = useCmfClowns()
  const [open, setOpen] = useState(false)

  const active: CmfPacket | undefined = packets?.find((p) => p.id === activePacketId)

  const summary = useMemo(
    () => summariseWorkspaceCoverage(packets ?? [], clowns ?? null),
    [packets, clowns]
  )

  const activeTone: ReadinessTone | null = active ? packetTone(active, clowns) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'group inline-flex items-center gap-3 rounded-xl border border-border/50',
            'bg-card/40 hover:bg-card/70 hover:border-border/80',
            'px-3 py-2.5 text-left transition-colors min-w-[260px]',
            'backdrop-blur-sm'
          )}
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary flex-shrink-0">
            <FileSpreadsheet className="h-4 w-4" />
            {activeTone && (
              <span
                aria-hidden
                className={cn(
                  'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card',
                  activeTone === 'ready' && 'bg-emerald-500',
                  activeTone === 'partial' && 'bg-amber-500',
                  activeTone === 'blocked' && 'bg-rose-500',
                  activeTone === 'empty' && 'bg-muted-foreground/40'
                )}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
              Packet
            </p>
            <p className="text-sm font-semibold tracking-tight truncate leading-tight">
              {isLoading
                ? 'Loading…'
                : active
                ? active.name
                : packets?.length
                ? `Choose a packet (${packets.length})`
                : 'No packets yet'}
            </p>
            {active?.cmfCode && (
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                {active.cmfCode}
              </p>
            )}
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[400px] p-1.5 max-h-[520px] overflow-y-auto"
      >
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading packets…
          </div>
        )}
        {!isLoading && (!packets || packets.length === 0) && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {"No packets yet. Click stage 01 'Schema' to import a workbook."}
          </p>
        )}

        {/* Aggregate readiness header — shows the designer at a glance how
            many packets can be generated right now vs. how many are blocked
            on missing clown references. */}
        {!isLoading && packets && packets.length > 0 && (
          <div className="px-3 py-2 mb-1 border-b border-border/40">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Readiness
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                {summary.readyPackets} ready
              </span>
              {summary.partialPackets > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {summary.partialPackets} partial
                </span>
              )}
              {summary.blockedPackets > 0 && (
                <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-3 w-3" />
                  {summary.blockedPackets} need clowns
                </span>
              )}
            </div>
          </div>
        )}

        <ul className="space-y-1">
          {packets?.map((packet) => {
            const isActive = packet.id === activePacketId
            const renderCount = packet.renders?.length ?? 0
            const coverage = clownCoverageForPacket(packet, clowns ?? null)
            const tone = packetTone(packet, clowns)
            const toneLabel =
              tone === 'ready'
                ? `${coverage.matched}/${coverage.total} ready`
                : tone === 'partial'
                ? `${coverage.matched}/${coverage.total} ready · ${coverage.blocked} need clowns`
                : tone === 'blocked'
                ? `${coverage.total} need clowns`
                : 'No SKUs'
            return (
              <li key={packet.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(packet.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    isActive ? 'bg-primary/10' : 'hover:bg-muted/60'
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 h-3 w-3 rounded-full flex items-center justify-center flex-shrink-0',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border/60'
                    )}
                  >
                    {isActive && <Check className="h-2 w-2" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          aria-hidden
                          className={cn(
                            'h-1.5 w-1.5 rounded-full flex-shrink-0',
                            tone === 'ready' && 'bg-emerald-500',
                            tone === 'partial' && 'bg-amber-500',
                            tone === 'blocked' && 'bg-rose-500',
                            tone === 'empty' && 'bg-muted-foreground/40'
                          )}
                        />
                        <p className="text-sm font-medium truncate">{packet.name}</p>
                      </div>
                      <span
                        className={cn(
                          'text-[9px] font-medium uppercase tracking-wider rounded-full px-1.5 py-0.5 flex-shrink-0',
                          packet.status === 'ready'
                            ? 'bg-primary/15 text-primary'
                            : packet.status === 'rendering'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                            : packet.status === 'failed'
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {STATUS_LABEL[packet.status] ?? packet.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/80 mt-0.5 font-mono uppercase tracking-wider">
                      {packet.cmfCode || '—'} · {renderCount} {renderCount === 1 ? 'SKU' : 'SKUs'} · {toneLabel}
                    </p>
                    {tone === 'blocked' && coverage.missingSlugs.length > 0 && (
                      <p className="text-[10px] text-rose-700 dark:text-rose-300 mt-0.5 truncate">
                        Needs: {coverage.missingSlugs.join(', ')}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
