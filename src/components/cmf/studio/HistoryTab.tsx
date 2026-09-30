'use client'

/**
 * History, made the old way: the packets and attempts the CMF Studio made before it used Damien's
 * template, kept to look at. They were drawn from Vesper's own prompt, with a clown that could
 * change between attempts, and approved with a flag, so none of them can go into a supplier PDF.
 * Nothing here can be changed.
 */

import { useState } from 'react'
import { ArrowUpRight, History, Loader2 } from 'lucide-react'
import { toViewUrl } from '@/lib/storage/refs'
import { useCmfHistory, useCmfHistoryPacket } from '@/hooks/useCmf'
import { Empty, Panel, Refusal, when } from './parts'

export function HistoryTab() {
  const { data: packets, isLoading, error } = useCmfHistory()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <p className="leading-relaxed max-w-3xl">
          Made the old way, before the CMF Studio used Damien&apos;s template: kept to look at, and read only. These renders were not made from the template filled by code, so none of them can go
          into a supplier PDF. To use a SKU, render it again under Render.
        </p>
      </div>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      <Refusal error={error} />
      {packets && packets.length === 0 && <Empty>Nothing was made the old way.</Empty>}
      {packets?.map((p) => (
        <Panel
          key={p.id}
          title={
            <button type="button" className="text-left hover:underline" onClick={() => setOpen(open === p.id ? null : p.id)}>
              {p.name}
              {p.cmfCode ? <span className="ml-2 font-mono text-[11px] text-muted-foreground">{p.cmfCode}</span> : null}
            </button>
          }
          hint={`${p.renders.length} ${p.renders.length === 1 ? 'SKU' : 'SKUs'} · last changed ${when(p.updatedAt)}`}
          actions={
            p.pdfUrl ? (
              <a href={toViewUrl(p.pdfUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">
                Packet PDF (old) <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : undefined
          }
        >
          {open === p.id && <PacketDetail packetId={p.id} />}
        </Panel>
      ))}
    </div>
  )
}

function PacketDetail({ packetId }: { packetId: string }) {
  const { data: packet, isLoading, error } = useCmfHistoryPacket(packetId)
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  if (error) return <Refusal error={error} />
  if (!packet) return null
  return (
    <div className="space-y-4">
      {packet.renders.map((r) => (
        <div key={r.id} className="space-y-2">
          <div className="text-xs font-medium">
            {r.label}
            {r.productCode ? <span className="ml-2 font-mono text-muted-foreground">{r.productCode}</span> : null}
          </div>
          {(r.renderAttempts ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No attempt.</p>
          ) : (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
              {(r.renderAttempts ?? []).map((a) => (
                <figure key={a.id} className="space-y-1">
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={toViewUrl(a.imageUrl)} alt={`${r.label}, attempt ${a.attemptNumber}`} className="aspect-square w-full rounded-lg border border-border/40 object-cover" />
                  ) : (
                    <div className="aspect-square w-full rounded-lg border border-dashed border-border/40" />
                  )}
                  <figcaption className="text-[11px] text-muted-foreground">
                    Attempt {a.attemptNumber} · {a.status}
                    {a.approvalStatus !== 'pending' ? ` · ${a.approvalStatus} the old way` : ''} · {when(a.createdAt)}
                    {(a.enhancedPrompt || a.basePrompt) && (
                      <details className="mt-1">
                        <summary className="cursor-pointer">The prompt it was drawn from</summary>
                        <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-snug">{a.enhancedPrompt || a.basePrompt}</pre>
                        {a.refinementPrompt && <p className="mt-1">Added by hand: {a.refinementPrompt}</p>}
                      </details>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
