'use client'

import { useMemo, useState } from 'react'
import {
  useCmfPacket,
  useGenerateCmfPdf,
  useGenerateCmfRender,
} from '@/hooks/useCmf'
import { Button } from '@/components/ui/button'
import { CmfRenderRow } from './CmfRenderRow'
import { useToast } from '@/components/ui/use-toast'
import {
  Loader2,
  Wand2,
  FileText,
  ImageIcon,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'

interface CmfPacketWorkspaceProps {
  packetId: string | null
  onOpenClownLibrary: () => void
}

export function CmfPacketWorkspace({
  packetId,
  onOpenClownLibrary,
}: CmfPacketWorkspaceProps) {
  const { data: packet, isLoading } = useCmfPacket(packetId)
  const generateRender = useGenerateCmfRender()
  const generatePdf = useGenerateCmfPdf()
  const { toast } = useToast()
  const [bulkRunning, setBulkRunning] = useState(false)

  const renderStats = useMemo(() => {
    if (!packet) return { total: 0, ready: 0, rendering: 0, failed: 0 }
    const stats = { total: packet.renders.length, ready: 0, rendering: 0, failed: 0 }
    packet.renders.forEach((r) => {
      if (r.status === 'ready') stats.ready += 1
      else if (r.status === 'rendering' || r.status === 'queued') stats.rendering += 1
      else if (r.status === 'failed') stats.failed += 1
    })
    return stats
  }, [packet])

  if (!packetId) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <ImageIcon className="h-5 w-5 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">No packet selected</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          Import a workbook on the left, or pick an existing packet to edit
          SKUs, generate renders, and export the CMF PDF.
        </p>
      </div>
    )
  }

  if (isLoading || !packet) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/30 p-12 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  async function handleRenderAll() {
    if (!packet) return
    setBulkRunning(true)
    try {
      // Sequential rendering keeps Gemini quota predictable. The hook updates
      // React Query state per-render so the UI tracks each row live.
      for (const render of packet.renders) {
        if (render.status === 'ready') continue
        try {
          await generateRender.mutateAsync({
            renderId: render.id,
            packetId: packet.id,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Render failed'
          toast({ title: `Render failed: ${render.label}`, description: message })
        }
      }
    } finally {
      setBulkRunning(false)
    }
  }

  async function handleGeneratePdf() {
    if (!packet) return
    try {
      await generatePdf.mutateAsync({ packetId: packet.id })
      toast({ title: 'PDF ready', description: `${packet.name} packet exported.` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF generation failed'
      toast({ title: 'PDF generation failed', description: message })
    }
  }

  const hasReadyRenders = renderStats.ready > 0
  const allowPdf = renderStats.ready === renderStats.total && renderStats.total > 0

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            {packet.cmfCode && (
              <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
                {packet.cmfCode}
              </p>
            )}
            <h2 className="text-2xl font-semibold tracking-tight truncate">
              {packet.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {renderStats.total} {renderStats.total === 1 ? 'SKU' : 'SKUs'} ·{' '}
              {renderStats.ready} ready
              {renderStats.rendering > 0 && ` · ${renderStats.rendering} rendering`}
              {renderStats.failed > 0 && ` · ${renderStats.failed} failed`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenClownLibrary}
              className="gap-1.5"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Manage clowns
            </Button>
            <Button
              size="sm"
              onClick={handleRenderAll}
              disabled={bulkRunning || renderStats.total === 0}
              className="gap-1.5"
            >
              {bulkRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Render all
            </Button>
            <Button
              size="sm"
              variant={allowPdf ? 'default' : 'secondary'}
              onClick={handleGeneratePdf}
              disabled={!hasReadyRenders || generatePdf.isPending}
              className="gap-1.5"
            >
              {generatePdf.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {packet.pdfUrl ? 'Regenerate PDF' : 'Generate PDF'}
            </Button>
            {packet.pdfUrl && (
              <Button asChild size="sm" variant="ghost" className="gap-1.5">
                <a href={packet.pdfUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open PDF
                </a>
              </Button>
            )}
          </div>
        </div>

        {!allowPdf && hasReadyRenders && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-100">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              {"Some SKUs aren't rendered yet. The PDF still exports, but the unrendered SKUs will show a placeholder."}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {packet.renders.map((render) => (
          <CmfRenderRow
            key={render.id}
            render={render}
            packetId={packet.id}
          />
        ))}
      </div>
    </div>
  )
}
