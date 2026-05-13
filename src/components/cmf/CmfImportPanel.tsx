'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useImportCmfWorkbook, type CmfMergeSummary } from '@/hooks/useCmf'
import { useToast } from '@/components/ui/use-toast'
import {
  Upload,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Package,
  ArrowUpRight,
} from 'lucide-react'

interface CmfImportPanelProps {
  /**
   * Fires whenever the workspace should adopt a new packet id.
   *
   * `source` distinguishes the two distinct hand-off moments:
   *   - `'auto'` is fired right after a successful import — the
   *     workspace switches in the background so the underlying
   *     gallery is already on the new packet when the designer
   *     closes the dialog.
   *   - `'explicit'` is fired when the designer clicks a packet
   *     in the success summary or the prominent "Open packet"
   *     CTA — a deliberate handoff, so the dialog should close.
   */
  onPacketCreated?: (packetId: string, source: 'auto' | 'explicit') => void
  /** Called when the user clicks a changed SKU in the merge summary so
   *  the workspace can scroll to that row. */
  onRenderFocus?: (packetId: string, renderId: string) => void
}

interface CreatedPacketSummary {
  id: string
  name: string
  productSlug: string | null
  productName: string | null
  renderCount: number
  mergeSummary?: CmfMergeSummary
}

export function CmfImportPanel({ onPacketCreated, onRenderFocus }: CmfImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [packetName, setPacketName] = useState('')
  const [cmfCode, setCmfCode] = useState('')
  const [errors, setErrors] = useState<
    Array<{ rowIndex: number; field?: string; message: string }>
  >([])
  const [lastSuccess, setLastSuccess] = useState<{
    rows: number
    packets: CreatedPacketSummary[]
  } | null>(null)
  const importMutation = useImportCmfWorkbook()
  const { toast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast({ title: 'No file', description: 'Pick an .xlsx workbook to import.' })
      return
    }
    setErrors([])
    setLastSuccess(null)
    try {
      const result = await importMutation.mutateAsync({
        file,
        packetName: packetName || undefined,
        cmfCode: cmfCode || undefined,
        createPacket: true,
      })
      const createdPackets: CreatedPacketSummary[] = (result.packets ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        productSlug: p.productSlug,
        productName: p.productName,
        renderCount: p.renderCount,
        mergeSummary: p.mergeSummary,
      }))
      const packetCount = createdPackets.length || (result.packet ? 1 : 0)
      // Aggregate diff stats across every packet so the toast can lead
      // with the human-meaningful summary instead of "X rows imported".
      const aggregate = createdPackets.reduce(
        (acc, p) => {
          const m = p.mergeSummary
          if (!m) return acc
          acc.added += m.added
          acc.updated += m.updated
          acc.unchanged += m.unchanged
          if (m.kind === 'merged') acc.mergedPackets++
          else acc.createdPackets++
          return acc
        },
        { added: 0, updated: 0, unchanged: 0, mergedPackets: 0, createdPackets: 0 }
      )
      // Compact "Switch 2, Cocoon" summary; falls back to packet name when
      // the catalog doesn't know the slug (so we never silently lose info).
      const productListLabel = createdPackets
        .map((p) => p.productName ?? p.name)
        .join(', ')
      if (result.import.errors.length > 0) {
        setErrors(result.import.errors)
        setLastSuccess(null)
        toast({
          title: 'Import had warnings',
          description: `${result.import.rowCount} rows imported, ${result.import.errors.length} rows skipped`,
        })
      } else {
        setLastSuccess({ rows: result.import.rowCount, packets: createdPackets })
        // Headline: prioritise the merge story over raw row counts so a
        // designer sees "1 changed, 2 added" not "imported 5 rows".
        const verbBits: string[] = []
        if (aggregate.added > 0) verbBits.push(`${aggregate.added} added`)
        if (aggregate.updated > 0) verbBits.push(`${aggregate.updated} changed`)
        if (aggregate.unchanged > 0) verbBits.push(`${aggregate.unchanged} unchanged`)
        const verb = verbBits.join(' · ') || `${result.import.rowCount} rows`
        toast({
          title:
            aggregate.mergedPackets > 0 && aggregate.createdPackets === 0
              ? 'Merged into existing packets'
              : aggregate.mergedPackets > 0
              ? 'Mixed import: created + merged'
              : 'Workbook imported',
          description:
            packetCount > 1 && productListLabel
              ? `${verb} across ${packetCount} packets (${productListLabel})`
              : `${verb}${productListLabel ? ` — ${productListLabel}` : ''}`,
        })
      }
      if (result.packet?.id) {
        // Auto-switch the workspace in the background so the gallery
        // underneath the dialog is already on the new packet. The
        // dialog itself stays open so the designer can see the
        // success summary and click "Open packet" — that's where the
        // explicit handoff happens.
        onPacketCreated?.(result.packet.id, 'auto')
      }
      // reset selection so the same file can be re-imported after edits
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      toast({ title: 'Import failed', description: message })
    }
  }

  async function handleDownloadTemplate() {
    const res = await fetch('/api/cmf/template?productSlug=switch2')
    if (!res.ok) {
      toast({ title: 'Failed to download template' })
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cmf-template-switch2.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Workbook (.xlsx)
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        {file && (
          <p className="text-xs text-muted-foreground truncate">{file.name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Packet name (optional)
        </Label>
        <Input
          value={packetName}
          onChange={(e) => setPacketName(e.target.value)}
          placeholder="Switch 2 Spring 2026"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          CMF code (optional)
        </Label>
        <Input
          value={cmfCode}
          onChange={(e) => setCmfCode(e.target.value)}
          placeholder="CMF-001234revA"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={importMutation.isPending} className="gap-2">
          {importMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDownloadTemplate}
          className="gap-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          Template
        </Button>
      </div>

      {lastSuccess && (
        <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.04] p-3.5 text-xs text-emerald-800 dark:text-emerald-100">
          {/* Header — names what just happened in plain English. The
              "where did it go?" answer lives in the cards below; this
              line just confirms the import landed cleanly. */}
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight">
                {lastSuccess.packets.length === 0
                  ? 'Workbook validated'
                  : lastSuccess.packets.length === 1
                  ? 'Imported into 1 packet'
                  : `Imported into ${lastSuccess.packets.length} packets`}
              </p>
              <p className="text-[11px] text-emerald-700/80 dark:text-emerald-200/70 mt-0.5">
                {lastSuccess.rows} {lastSuccess.rows === 1 ? 'row' : 'rows'} parsed
                {lastSuccess.packets.length > 0 &&
                  ' — open a packet below to see the result.'}
              </p>
            </div>
          </div>

          {/* Per-packet cards — each one is the explicit "this is where
              your workbook went" handoff. The big "Open packet" CTA on
              the right makes the destination unmissable; clicking it
              closes the dialog and lands on the gallery. The whole
              card is also clickable so casual taps work. */}
          {lastSuccess.packets.length > 0 && (
            <ul className="space-y-2">
              {lastSuccess.packets.map((p) => {
                const m = p.mergeSummary
                const merged = m?.kind === 'merged'
                return (
                  <li key={p.id}>
                    <div className="rounded-md border border-emerald-500/30 bg-background/40 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => onPacketCreated?.(p.id, 'explicit')}
                        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-emerald-500/[0.06] transition-colors"
                      >
                        <Package className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-foreground truncate">
                              {p.productName ?? p.name}
                            </span>
                            <span
                              className={
                                merged
                                  ? 'rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-400/20 dark:text-amber-200'
                                  : 'rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200'
                              }
                            >
                              {merged ? 'Merged' : 'Created'}
                            </span>
                            {p.mergeSummary?.cmfCode && (
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                {p.mergeSummary.cmfCode}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {p.renderCount} {p.renderCount === 1 ? 'SKU' : 'SKUs'}
                            {m && (
                              <>
                                {m.added > 0 && (
                                  <>
                                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                                    <span className="text-emerald-700 dark:text-emerald-300">
                                      {m.added} added
                                    </span>
                                  </>
                                )}
                                {m.updated > 0 && (
                                  <>
                                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                                    <span className="text-amber-700 dark:text-amber-300">
                                      {m.updated} changed
                                    </span>
                                  </>
                                )}
                                {m.unchanged > 0 && (
                                  <>
                                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                                    <span>{m.unchanged} unchanged</span>
                                  </>
                                )}
                              </>
                            )}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200 group-hover:bg-emerald-500/25 transition-colors flex-shrink-0">
                          Open packet
                          <ArrowUpRight className="h-3 w-3" />
                        </span>
                      </button>
                      {/* Per-SKU diff — only when there's something
                          worth pointing at. The chips are clickable so
                          a designer can jump straight to the changed
                          row in the gallery. */}
                      {m && m.changes.length > 0 && (
                        <div className="border-t border-emerald-500/20 bg-emerald-500/[0.03] px-3 py-2 space-y-1">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700/70 dark:text-emerald-200/70">
                            Changed SKUs
                          </p>
                          <ul className="space-y-0.5 text-[11px]">
                            {m.changes.slice(0, 6).map((change) => (
                              <li key={change.renderId}>
                                <button
                                  type="button"
                                  onClick={() => onRenderFocus?.(p.id, change.renderId)}
                                  className="text-left underline-offset-2 hover:underline text-foreground/90"
                                >
                                  <span className="font-medium">{change.label}</span>
                                  {change.changedRegions.length > 0 && (
                                    <span className="text-amber-700/80 dark:text-amber-300/80">
                                      {' '}
                                      · {change.changedRegions.join(', ')}
                                    </span>
                                  )}
                                  {change.paletteChanged && (
                                    <span className="text-amber-700/80 dark:text-amber-300/80">
                                      {change.changedRegions.length > 0
                                        ? ' + palette'
                                        : ' · palette'}
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                            {m.changes.length > 6 && (
                              <li className="italic opacity-70">
                                …and {m.changes.length - 6} more
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Footer hint — only relevant when multiple packets were
              created (multi-product workbook). For the common case
              of a single product we skip it since the single Open
              CTA above is already obvious. */}
          {lastSuccess.packets.length > 1 && (
            <p className="text-[11px] italic text-emerald-700/70 dark:text-emerald-200/70 pl-6">
              Each product became its own packet — open any one to
              start the recolour pass.
            </p>
          )}

        </div>
      )}

      {errors.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Skipped {errors.length} {errors.length === 1 ? 'row' : 'rows'}
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {errors.slice(0, 12).map((err, idx) => (
              <li key={idx} className="font-mono text-[11px] leading-snug">
                row {err.rowIndex + 1}
                {err.field ? ` · ${err.field}` : ''}: {err.message}
              </li>
            ))}
            {errors.length > 12 && (
              <li className="text-[11px] italic">
                …and {errors.length - 12} more
              </li>
            )}
          </ul>
        </div>
      )}
    </form>
  )
}
