'use client'

/**
 * CmfReferenceUploadInline — slim clown reference uploader designed
 * to live INSIDE the import dialog (workbook + references in one
 * flow). Mirrors the BulkUploadForm in `CmfClownLibraryDialog` but
 * without the surrounding tabs / hero / report so it composes
 * cleanly under the workbook section.
 *
 * Why a sibling component instead of reusing the library dialog's
 * panel: the library dialog is a different mental model ("browse +
 * fix individual variants") and its tabs/single-PNG path adds
 * surface area we don't need at first-import time. Here we want the
 * 80% case — drop the canonical zip pack, the server maps it, done.
 */

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useUploadClownsBulk, type CmfClownBulkResult } from '@/hooks/useCmf'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Loader2,
  Upload,
} from 'lucide-react'

interface CmfReferenceUploadInlineProps {
  /** Optional callback fired after a successful upload — used by the
   *  parent dialog to refresh queries / log telemetry. */
  onUploaded?: (summary: {
    uploaded: number
    replaced: number
    skipped: number
    total: number
  }) => void
}

export function CmfReferenceUploadInline({
  onUploaded,
}: CmfReferenceUploadInlineProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [lastReport, setLastReport] = useState<{
    summary: { uploaded: number; replaced: number; skipped: number; total: number }
    results: CmfClownBulkResult[]
  } | null>(null)
  const bulk = useUploadClownsBulk()
  const { toast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0) {
      toast({ title: 'Pick one or more .zip files first' })
      return
    }
    try {
      const report = await bulk.mutateAsync({ files })
      setLastReport(report)
      const { uploaded, replaced, skipped } = report.summary
      toast({
        title: 'Bulk upload complete',
        description: `${uploaded} new, ${replaced} replaced, ${skipped} skipped.`,
      })
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      onUploaded?.(report.summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk upload failed'
      toast({ title: 'Bulk upload failed', description: message })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Reference zips
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Drop the canonical &ldquo;Clown Renders&rdquo; zip(s). The server maps
          each zip name to a product (e.g. <code>switch 2 clown for claude.zip</code>{' '}
          → <code>switch2</code>) and derives variant slugs from each PNG&rsquo;s
          filename. Optional — you can also import the workbook first and add
          references later.
        </p>
      </div>

      {files.length > 0 && (
        <div className="rounded-md border border-border/40 bg-background/40 p-2 space-y-1 max-h-24 overflow-y-auto">
          {files.map((f, i) => (
            <p key={i} className="text-[11px] font-mono text-muted-foreground truncate">
              <Archive className="inline h-3 w-3 mr-1 opacity-60" />
              {f.name}{' '}
              <span className="text-muted-foreground/60">
                ({(f.size / 1024).toFixed(0)} KB)
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={bulk.isPending || files.length === 0}
          className="gap-1.5"
        >
          {bulk.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {bulk.isPending
            ? 'Uploading…'
            : `Upload ${files.length || ''} reference zip${files.length === 1 ? '' : 's'}`}
        </Button>
      </div>

      {lastReport && (
        <div className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-1.5 text-xs">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              {lastReport.summary.uploaded} new
            </span>
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
              <CheckCircle2 className="h-3 w-3" />
              {lastReport.summary.replaced} replaced
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <AlertCircle className="h-3 w-3" />
              {lastReport.summary.skipped} skipped
            </span>
          </div>
          {lastReport.results.length > 0 && (
            <div className="max-h-28 overflow-y-auto space-y-0.5 border-t border-border/40 pt-1.5">
              {lastReport.results.slice(0, 8).map((r, i) => (
                <p
                  key={i}
                  className={cn(
                    'text-[10px] font-mono leading-snug truncate',
                    r.status === 'error' && 'text-destructive',
                    r.status === 'skipped' && 'text-muted-foreground/70',
                    r.status === 'replaced' && 'text-amber-700 dark:text-amber-300',
                    r.status === 'uploaded' && 'text-emerald-700 dark:text-emerald-300'
                  )}
                  title={r.message}
                >
                  [{r.status}] {r.zip} → {r.inner}
                </p>
              ))}
              {lastReport.results.length > 8 && (
                <p className="text-[10px] italic text-muted-foreground/60">
                  …and {lastReport.results.length - 8} more
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </form>
  )
}
