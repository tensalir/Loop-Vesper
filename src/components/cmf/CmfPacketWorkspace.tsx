'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  useCmfClowns,
  useCmfPacket,
  useGenerateCmfPdf,
  useGenerateCmfRender,
} from '@/hooks/useCmf'
import { Button } from '@/components/ui/button'
import { CmfRenderRow } from './CmfRenderRow'
import { CmfPipelineHeader } from './CmfPipelineHeader'
import { CmfPacketSelector } from './CmfPacketSelector'
import { CmfImportDialog } from './CmfImportDialog'
import { CmfClownLibraryDialog } from './CmfClownLibraryDialog'
import { CmfClownLibraryPill } from './CmfClownLibraryPill'
import { CmfMembersDialog } from './CmfMembersDialog'
import { CmfPresenceStack } from './CmfPresenceStack'
import { CmfActivityDrawer } from './CmfActivityDrawer'
import { useToast } from '@/components/ui/use-toast'
import {
  Loader2,
  Wand2,
  ArrowUpRight,
  AlertTriangle,
  Database,
} from 'lucide-react'

interface CmfPacketWorkspaceProps {
  initialPacketId: string | null
}

/**
 * Single dense workspace surface. The pipeline header is the spine; the
 * packet selector + global controls float above the SKU list. Drawers for
 * import / clown library are launched directly from the matching stage
 * card so the data-source connection is visually obvious.
 */
export function CmfPacketWorkspace({ initialPacketId }: CmfPacketWorkspaceProps) {
  const [activePacketId, setActivePacketId] = useState<string | null>(initialPacketId)
  const [importOpen, setImportOpen] = useState(false)
  const [clownOpen, setClownOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)

  const { data: packet, isLoading } = useCmfPacket(activePacketId)
  const { data: clowns } = useCmfClowns()
  const generateRender = useGenerateCmfRender()
  const generatePdf = useGenerateCmfPdf()
  const { toast } = useToast()

  // If the packet hasn't been picked yet but one packet exists, auto-select
  // it on first render so the page never shows an empty "No packet" panel
  // when there's an obvious choice. We only do this once per mount.
  useEffect(() => {
    if (initialPacketId) setActivePacketId(initialPacketId)
  }, [initialPacketId])

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

  // Coverage: how many SKU rows have a clown asset that matches their
  // product slug. Drives the references stage in the pipeline header.
  const clownCoverage = useMemo(() => {
    if (!packet || !clowns) return undefined
    const slugs = new Set(clowns.map((c) => `${c.productSlug}:${c.variantSlug}`))
    let matched = 0
    for (const render of packet.renders) {
      if (render.clownAssetId) {
        matched += 1
        continue
      }
      if (slugs.has(`${render.productSlug}:${render.variantSlug}`)) {
        matched += 1
      }
    }
    return { matched, total: packet.renders.length }
  }, [packet, clowns])

  async function handleRenderAll() {
    if (!packet) return
    setBulkRunning(true)
    try {
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
    if (!packet) {
      setImportOpen(true)
      return
    }
    if (renderStats.ready === 0) {
      toast({
        title: 'Render at least one SKU first',
        description: 'The PDF embeds the rendered images per SKU.',
      })
      return
    }
    try {
      await generatePdf.mutateAsync({ packetId: packet.id })
      toast({
        title: 'PDF ready',
        description: `${packet.name} packet exported.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF generation failed'
      toast({ title: 'PDF generation failed', description: message })
    }
  }

  // Pipeline stage handlers — each opens the right drawer / runs the right
  // bulk action so the stage card is the entry point for that part of the
  // flow. Disabled stages already short-circuit clicks via the button.
  const handleSchemaClick = () => setImportOpen(true)
  const handleReferencesClick = () => setClownOpen(true)
  const handleRenderClick = () => {
    if (!packet) {
      setImportOpen(true)
      return
    }
    handleRenderAll()
  }
  const handleExportClick = () => {
    if (packet?.pdfUrl) {
      window.open(packet.pdfUrl, '_blank', 'noopener,noreferrer')
      return
    }
    handleGeneratePdf()
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Page header — packet identity + global actions, kept tight */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Loop · Product · CMF
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            CMF Studio
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
            One pipeline from a single source of truth: workbook → resolved
            references → photoreal renders → packet PDF.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CmfPacketSelector
            activePacketId={activePacketId}
            onSelect={setActivePacketId}
          />
          {/* The clown library is workspace-shared — it doesn't belong inside
              a packet's empty state. Surfacing it here keeps the per-packet
              flow focused on workbooks and renders, while still letting
              designers reach references from any state. */}
          <CmfClownLibraryPill onClick={() => setClownOpen(true)} />
          {activePacketId && (
            <>
              <CmfPresenceStack
                packetId={activePacketId}
                onClick={() => setMembersOpen(true)}
              />
              <CmfActivityDrawer packetId={activePacketId} />
            </>
          )}
        </div>
      </header>

      {/* Pipeline spine */}
      <CmfPipelineHeader
        packet={packet ?? null}
        clownCoverage={clownCoverage}
        importErrorCount={0}
        onSchemaClick={handleSchemaClick}
        onReferencesClick={handleReferencesClick}
        onRenderClick={handleRenderClick}
        onExportClick={handleExportClick}
      />

      {/* Workspace body */}
      {!activePacketId ? (
        <EmptyState onImportClick={() => setImportOpen(true)} />
      ) : isLoading || !packet ? (
        <div className="rounded-2xl border border-border/50 bg-card/30 p-12 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Quick action row — drives the SKU table below */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {renderStats.total} {renderStats.total === 1 ? 'SKU' : 'SKUs'}
              </span>
              <span className="mx-2 text-muted-foreground/40">·</span>
              {renderStats.ready} ready
              {renderStats.rendering > 0 && ` · ${renderStats.rendering} rendering`}
              {renderStats.failed > 0 && ` · ${renderStats.failed} failed`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
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
                onClick={handleGeneratePdf}
                disabled={renderStats.ready === 0 || generatePdf.isPending}
                className="gap-1.5"
              >
                {generatePdf.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                )}
                {packet.pdfUrl ? 'Regenerate PDF' : 'Generate PDF'}
              </Button>
            </div>
          </div>

          {/* Render rows */}
          <div className="space-y-3">
            {packet.renders.map((render) => (
              <CmfRenderRow
                key={render.id}
                render={render}
                packetId={packet.id}
              />
            ))}
          </div>

          {renderStats.failed > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span className="leading-snug">
                {renderStats.failed} {renderStats.failed === 1 ? 'render' : 'renders'} failed.
                Open the row for the error and re-run.
              </span>
            </div>
          )}
        </>
      )}

      <CmfImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onPacketCreated={(id) => setActivePacketId(id)}
      />
      <CmfClownLibraryDialog open={clownOpen} onOpenChange={setClownOpen} />
      <CmfMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        packetId={activePacketId}
      />
    </div>
  )
}

/* ─── Empty state ───────────────────────────────────────────────────────── */

function EmptyState({ onImportClick }: { onImportClick: () => void }) {
  // The empty state is now strictly about creating a packet. Anything
  // workspace-wide (clown library, member roster, activity log) lives in
  // the header pill row above so it's reachable from every state.
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-dashed border-border/50 bg-card/20 p-10 md:p-14"
      style={{
        backgroundImage:
          'radial-gradient(50% 60% at 50% 0%, color-mix(in oklch, hsl(var(--primary)) 8%, transparent), transparent 70%)',
      }}
    >
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground/70">
          Start a packet
        </p>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
          A workbook in. A packet PDF out.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          Drop your CMF schema and Vesper takes it from there: per-SKU
          recolour with Nano Banana Pro, palette breakdown, packet PDF.
        </p>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button onClick={onImportClick} className="gap-2">
            <Database className="h-4 w-4" />
            Import workbook
          </Button>
        </div>
      </div>
    </div>
  )
}
