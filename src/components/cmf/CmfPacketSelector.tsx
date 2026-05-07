'use client'

import { useState } from 'react'
import { useCmfPackets, type CmfPacket } from '@/hooks/useCmf'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Check, ChevronDown, FileSpreadsheet, Loader2 } from 'lucide-react'

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

/**
 * Compact packet selector used as the workspace's left-hand identifier.
 * Designed to feel like the project switcher in /projects/[id] — small
 * pill, click-to-open dropdown, never steals attention from the pipeline.
 */
export function CmfPacketSelector({ activePacketId, onSelect }: CmfPacketSelectorProps) {
  const { data: packets, isLoading } = useCmfPackets()
  const [open, setOpen] = useState(false)

  const active: CmfPacket | undefined = packets?.find((p) => p.id === activePacketId)

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
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary flex-shrink-0">
            <FileSpreadsheet className="h-4 w-4" />
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
        className="w-[360px] p-1.5 max-h-[480px] overflow-y-auto"
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
        <ul className="space-y-1">
          {packets?.map((packet) => {
            const isActive = packet.id === activePacketId
            const renderCount = packet.renders?.length ?? 0
            const ready = packet.renders?.filter((r) => r.status === 'ready').length ?? 0
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
                    isActive
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/60'
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
                      <p className="text-sm font-medium truncate">{packet.name}</p>
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
                      {packet.cmfCode || '—'} · {ready}/{renderCount} ready
                    </p>
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
