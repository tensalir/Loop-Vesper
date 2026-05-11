'use client'

/**
 * CMF Studio workspace shell.
 *
 * Six-stage spine matching the encoded `loop-cmf-generation` skill:
 *
 *   01 Schema  → import workbook
 *   02 References → clown library
 *   03 Generate → bulk Nano Banana attempts
 *   04 Review  → gallery / approve / archive
 *   05 Preview → editable HTML layout
 *   06 Export  → packet PDF (gated on approvals)
 *
 * Stage 03 → 06 all consume the same packet query so the workspace stays a
 * single source of truth. The gallery is the focal surface — the pipeline
 * header carries flow context, the rows do the work.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  CmfPacket,
  useCmfClowns,
  useCmfPacket,
  useGenerateCmfPdf,
  useBulkGenerateCmfPacket,
} from '@/hooks/useCmf'
import { Button } from '@/components/ui/button'
import { CmfAttemptGallery } from './CmfAttemptGallery'
import { CmfPipelineHeader } from './CmfPipelineHeader'
import { CmfPacketSelector } from './CmfPacketSelector'
import { CmfImportDialog } from './CmfImportDialog'
import { CmfClownLibraryDialog } from './CmfClownLibraryDialog'
import { CmfClownLibraryPill } from './CmfClownLibraryPill'
import { CmfMembersDialog } from './CmfMembersDialog'
import { CmfPresenceStack } from './CmfPresenceStack'
import { CmfActivityDrawer } from './CmfActivityDrawer'
import { CmfDocumentPreviewDialog } from './CmfDocumentPreviewDialog'
import { useToast } from '@/components/ui/use-toast'
import {
  Loader2,
  Wand2,
  ArrowUpRight,
  AlertTriangle,
  Database,
  LayoutTemplate,
} from 'lucide-react'

interface CmfPacketWorkspaceProps {
  initialPacketId: string | null
}

export function CmfPacketWorkspace({ initialPacketId }: CmfPacketWorkspaceProps) {
  const [activePacketId, setActivePacketId] = useState<string | null>(initialPacketId)
  const [importOpen, setImportOpen] = useState(false)
  const [clownOpen, setClownOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)

  const { data: packet, isLoading } = useCmfPacket(activePacketId)
  const { data: clowns } = useCmfClowns()
  const bulkGenerate = useBulkGenerateCmfPacket()
  const generatePdf = useGenerateCmfPdf()
  const { toast } = useToast()

  useEffect(() => {
    if (initialPacketId) setActivePacketId(initialPacketId)
  }, [initialPacketId])

  const readiness = useMemo(() => summarisePacketReadiness(packet), [packet])
  const totalAttempts = useMemo(
    () => packet?.renders.reduce((s, r) => s + (r.renderAttempts?.length ?? 0), 0) ?? 0,
    [packet]
  )

  // Coverage mirrors the render service's three-tier fallback so the badge
  // doesn't lie:
  //   1. An explicit clownAssetId on the render row → counts.
  //   2. An exact (productSlug, variantSlug) match in the library → counts.
  //   3. Any clown for the product (regardless of variant) → counts, because
  //      runCmfRender will pick that up automatically.
  const clownCoverage = useMemo(() => {
    if (!packet || !clowns) return undefined
    const productHasAny = new Set<string>()
    const exactMatch = new Set<string>()
    for (const c of clowns) {
      productHasAny.add(c.productSlug)
      exactMatch.add(`${c.productSlug}:${c.variantSlug}`)
    }
    let matched = 0
    for (const render of packet.renders) {
      if (render.clownAssetId) {
        matched += 1
        continue
      }
      if (exactMatch.has(`${render.productSlug}:${render.variantSlug}`)) {
        matched += 1
        continue
      }
      if (productHasAny.has(render.productSlug)) {
        matched += 1
      }
    }
    return { matched, total: packet.renders.length }
  }, [packet, clowns])

  async function handleBulkGenerate(attemptsPerSku = 3) {
    if (!packet) return
    setBulkRunning(true)
    try {
      const result = await bulkGenerate.mutateAsync({
        packetId: packet.id,
        attemptsPerSku,
      })
      toast({
        title: 'Bulk burst complete',
        description: `${result.summary.started}/${result.summary.attempts} attempts succeeded${
          result.summary.failed > 0 ? ` · ${result.summary.failed} failed` : ''
        }`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk render failed'
      toast({ title: 'Bulk render failed', description: message })
    } finally {
      setBulkRunning(false)
    }
  }

  async function handleGeneratePdf(allowDraft = false) {
    if (!packet) {
      setImportOpen(true)
      return
    }
    if (readiness.approved === 0 && !allowDraft) {
      toast({
        title: 'Approve at least one SKU first',
        description: 'Export is gated on approvals. Use Preview to approve.',
      })
      return
    }
    try {
      await generatePdf.mutateAsync({ packetId: packet.id, allowDraft })
      toast({
        title: allowDraft ? 'DRAFT PDF ready' : 'PDF ready',
        description: `${packet.name} packet exported.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF generation failed'
      toast({ title: 'PDF generation failed', description: message })
    }
  }

  // Stage handlers feed into the pipeline header.
  const handleSchemaClick = () => setImportOpen(true)
  const handleReferencesClick = () => setClownOpen(true)
  const handleGenerateClick = () => {
    if (!packet) {
      setImportOpen(true)
      return
    }
    handleBulkGenerate()
  }
  const handleReviewClick = () => {
    // Scroll the gallery section into view — the gallery itself is always
    // visible when a packet is loaded, so we just nudge the page.
    document.getElementById('cmf-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const handlePreviewClick = () => {
    if (!packet) return
    setPreviewOpen(true)
  }
  const handleExportClick = () => {
    if (packet?.pdfUrl) {
      window.open(packet.pdfUrl, '_blank', 'noopener,noreferrer')
      return
    }
    handleGeneratePdf(readiness.approved < readiness.total)
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Loop · Product · CMF
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">CMF Studio</h1>
          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
            Workbook in. Nano Banana bulk. Approve, preview, export. The
            CMF skill carries the judgment; this surface carries the work.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CmfPacketSelector activePacketId={activePacketId} onSelect={setActivePacketId} />
          <CmfClownLibraryPill onClick={() => setClownOpen(true)} />
          {activePacketId && (
            <>
              <CmfPresenceStack packetId={activePacketId} onClick={() => setMembersOpen(true)} />
              <CmfActivityDrawer packetId={activePacketId} />
            </>
          )}
        </div>
      </header>

      <CmfPipelineHeader
        packet={packet ?? null}
        clownCoverage={clownCoverage}
        importErrorCount={0}
        readiness={readiness}
        onSchemaClick={handleSchemaClick}
        onReferencesClick={handleReferencesClick}
        onGenerateClick={handleGenerateClick}
        onReviewClick={handleReviewClick}
        onPreviewClick={handlePreviewClick}
        onExportClick={handleExportClick}
      />

      {!activePacketId ? (
        <EmptyState onImportClick={() => setImportOpen(true)} />
      ) : isLoading || !packet ? (
        <div className="rounded-2xl border border-border/50 bg-card/30 p-12 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Action row */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {readiness.total} {readiness.total === 1 ? 'SKU' : 'SKUs'}
              </span>
              <span className="mx-2 text-muted-foreground/40">·</span>
              {readiness.approved} approved
              {readiness.draftOnly > 0 && ` · ${readiness.draftOnly} draft`}
              {readiness.missing > 0 && ` · ${readiness.missing} missing`}
              {totalAttempts > 0 && (
                <>
                  <span className="mx-2 text-muted-foreground/40">·</span>
                  {totalAttempts} {totalAttempts === 1 ? 'attempt' : 'attempts'}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkGenerate(3)}
                disabled={bulkRunning || readiness.total === 0}
                className="gap-1.5"
              >
                {bulkRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Bulk · 3 attempts each
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPreviewOpen(true)}
                disabled={readiness.approved === 0 && readiness.draftOnly === 0}
                className="gap-1.5"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                Preview
              </Button>
              <Button
                size="sm"
                onClick={() => handleGeneratePdf(readiness.approved < readiness.total)}
                disabled={generatePdf.isPending || readiness.approved === 0}
                className="gap-1.5"
              >
                {generatePdf.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                )}
                {packet.pdfUrl
                  ? 'Regenerate PDF'
                  : readiness.approved < readiness.total
                  ? 'Export DRAFT'
                  : 'Generate PDF'}
              </Button>
            </div>
          </div>

          <section id="cmf-gallery" className="space-y-3">
            {packet.renders.map((render) => (
              <CmfAttemptGallery key={render.id} render={render} packetId={packet.id} />
            ))}
          </section>

          {readiness.missing > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span className="leading-snug">
                {readiness.missing} {readiness.missing === 1 ? 'SKU has' : 'SKUs have'} no
                attempts yet. Run the bulk burst or generate an attempt per row.
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
      <CmfDocumentPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        packet={packet ?? null}
        onExport={(allowDraft) => handleGeneratePdf(allowDraft)}
        exporting={generatePdf.isPending}
      />
    </div>
  )
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function summarisePacketReadiness(packet: CmfPacket | null | undefined) {
  if (!packet) return { total: 0, approved: 0, draftOnly: 0, missing: 0 }
  let approved = 0
  let draftOnly = 0
  let missing = 0
  for (const render of packet.renders) {
    const attempts = render.renderAttempts ?? []
    const hasApproved = attempts.some((a) => a.approvalStatus === 'approved')
    if (hasApproved) {
      approved += 1
      continue
    }
    const hasReady = attempts.some((a) => a.status === 'ready' && a.approvalStatus !== 'archived')
    if (hasReady) {
      draftOnly += 1
    } else {
      missing += 1
    }
  }
  return { total: packet.renders.length, approved, draftOnly, missing }
}

function EmptyState({ onImportClick }: { onImportClick: () => void }) {
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
          Drop your CMF schema and Vesper takes it from there: bulk
          recolour per SKU, approve the best attempts, preview the layout,
          export the packet.
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
