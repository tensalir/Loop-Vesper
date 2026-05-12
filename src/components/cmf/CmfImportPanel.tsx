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
  Plus,
  Pencil,
  Equal,
} from 'lucide-react'

interface CmfImportPanelProps {
  onPacketCreated?: (packetId: string) => void
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
        onPacketCreated?.(result.packet.id)
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
        <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Imported {lastSuccess.rows} {lastSuccess.rows === 1 ? 'row' : 'rows'} cleanly
              {lastSuccess.packets.length > 1
                ? ` across ${lastSuccess.packets.length} product packets.`
                : '.'}
            </span>
          </div>
          {lastSuccess.packets.length > 0 && (
            <ul className="space-y-2 pl-6">
              {lastSuccess.packets.map((p) => {
                const m = p.mergeSummary
                const merged = m?.kind === 'merged'
                return (
                  <li key={p.id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Package className="h-3 w-3 flex-shrink-0 opacity-70" />
                      <button
                        type="button"
                        onClick={() => onPacketCreated?.(p.id)}
                        className="text-left font-medium underline-offset-2 hover:underline"
                      >
                        {p.productName ?? p.name}
                      </button>
                      {p.mergeSummary?.cmfCode && (
                        <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
                          {p.mergeSummary.cmfCode}
                        </span>
                      )}
                      <span
                        className={
                          merged
                            ? 'rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-400/20 dark:text-amber-200'
                            : 'rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200'
                        }
                      >
                        {merged ? 'Merged' : 'Created'}
                      </span>
                    </div>
                    {m && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[11px]">
                        {m.added > 0 && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                            <Plus className="h-3 w-3" /> {m.added} added
                          </span>
                        )}
                        {m.updated > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <Pencil className="h-3 w-3" /> {m.updated} changed
                          </span>
                        )}
                        {m.unchanged > 0 && (
                          <span className="inline-flex items-center gap-1 opacity-70">
                            <Equal className="h-3 w-3" /> {m.unchanged} unchanged
                          </span>
                        )}
                      </div>
                    )}
                    {m && m.changes.length > 0 && (
                      <ul className="ml-5 space-y-0.5 border-l border-amber-500/30 pl-3 text-[11px]">
                        {m.changes.slice(0, 6).map((change) => (
                          <li key={change.renderId}>
                            <button
                              type="button"
                              onClick={() => onRenderFocus?.(p.id, change.renderId)}
                              className="text-left underline-offset-2 hover:underline"
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
                                  {change.changedRegions.length > 0 ? ' + palette' : ' · palette'}
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
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {lastSuccess.packets.length > 1 && (
            <p className="pl-6 text-[11px] italic text-emerald-700/70 dark:text-emerald-200/70">
              Each product is its own packet — click any name to open it.
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
