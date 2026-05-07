'use client'

import { cn } from '@/lib/utils'
import { useCmfPackets } from '@/hooks/useCmf'
import { Loader2, FileSpreadsheet, FileText } from 'lucide-react'

interface CmfPacketListProps {
  activePacketId: string | null
  onSelect: (id: string) => void
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed',
}

export function CmfPacketList({ activePacketId, onSelect }: CmfPacketListProps) {
  const { data: packets, isLoading } = useCmfPackets()

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-wide uppercase">Packets</h2>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading packets…
        </div>
      )}

      {!isLoading && (!packets || packets.length === 0) && (
        <p className="text-xs text-muted-foreground">
          {"No packets yet. Import a workbook to begin."}
        </p>
      )}

      <ul className="space-y-1.5">
        {packets?.map((packet) => {
          const isActive = packet.id === activePacketId
          const renderCount = packet.renders?.length ?? 0
          const ready = packet.renders?.filter((r) => r.status === 'ready').length ?? 0
          return (
            <li key={packet.id}>
              <button
                onClick={() => onSelect(packet.id)}
                className={cn(
                  'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
                  isActive
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border/40 hover:bg-muted/50 hover:border-border/70'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{packet.name}</p>
                    {packet.cmfCode && (
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mt-0.5">
                        {packet.cmfCode}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-medium uppercase tracking-wider rounded-full px-2 py-0.5',
                      packet.status === 'ready'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
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
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {ready}/{renderCount} renders ready
                  </span>
                  {packet.pdfUrl && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <FileText className="h-3 w-3" />
                      PDF
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
