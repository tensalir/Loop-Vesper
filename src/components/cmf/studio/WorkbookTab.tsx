'use client'

/**
 * Workbook: upload the CMF workbook as exported, and see what Vesper read from it. The file is
 * read by the same parse every CMF step uses, in the CMF Studio and in Claude (an upload is named
 * by its id there), so what shows here is what a prompt and a supplier PDF are built from.
 */

import { useRef } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCmfUpload, useUploadWorkbook, type CmfListing } from '@/hooks/useCmf'
import { Empty, KeyState, Panel, Picker, Refusal, short, when } from './parts'

export function WorkbookTab({
  listing,
  importId,
  onImportChange,
}: {
  listing: CmfListing
  importId: string | null
  onImportChange: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const upload = useUploadWorkbook()
  const { data: view, isLoading, error } = useCmfUpload(importId)

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      const got = await upload.mutateAsync(file)
      onImportChange(got.import_id)
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Upload the workbook"
        hint="Export the CMF workbook as .xlsx and upload it here. Every render, grade and supplier PDF names the upload it was made from, and Claude can use the same upload by its id."
        actions={
          <>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" className="gap-1.5" onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload workbook
            </Button>
          </>
        }
      >
        <Refusal error={upload.error} />
        {listing.uploads.length > 0 ? (
          <Picker
            label="Upload"
            value={importId ?? ''}
            placeholder="Pick an upload"
            options={listing.uploads.map((u) => ({ value: u.import_id, label: `${u.file} · ${when(u.uploaded_at)}` }))}
            onChange={onImportChange}
          />
        ) : (
          <Empty>No workbook has been uploaded yet.</Empty>
        )}
      </Panel>

      {importId && (
        <Panel
          title={view ? view.file : 'The upload'}
          hint={
            view ? (
              <>
                Upload <span className="font-mono">{view.import_id}</span> · sha256 <span className="font-mono">{short(view.sha256)}</span> · modified {view.modified ?? 'unknown'}
                {view.modified_source ? ` (${view.modified_source})` : ''} · uploaded {when(view.imported_at)}
              </>
            ) : undefined
          }
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Refusal error={error} />
          {view?.tabs.map((t) => (
            <div key={t.tab} className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{t.tab}</h3>
                <span className="text-[11px] text-muted-foreground">{t.slug ? `in the kit as ${t.slug}` : 'not a tab the kit knows: nothing can be made from it'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-3 font-medium">Column</th>
                      <th className="py-1 pr-3 font-medium">Header</th>
                      <th className="py-1 pr-3 font-medium">Product name</th>
                      <th className="py-1 pr-3 font-medium">In scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.skus.map((s) => (
                      <tr key={s.column} className="border-t border-border/30">
                        <td className="py-1 pr-3 font-mono">{s.column}</td>
                        <td className="py-1 pr-3">{s.header ?? ''}</td>
                        <td className="py-1 pr-3">{s.name ?? ''}</td>
                        <td className="py-1 pr-3">{s.in_scope ? 'yes' : `no${s.scope_reason ? ` (${s.scope_reason})` : ''}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.slug && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Clown keys:</span>
                  {t.keys.length === 0 && <span className="text-muted-foreground">none in the kit</span>}
                  {t.keys.map((k) => (
                    <span key={k.id} className="inline-flex items-center gap-1.5">
                      <span className="font-mono">{k.id}</span>
                      <KeyState keyState={k} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}

      <Panel title="The kit's tabs" hint={`What the product kit ${listing.kit_tag ?? listing.kit_version} knows, with each key's state.`}>
        <div className="grid gap-2 md:grid-cols-2">
          {listing.tabs.map((t) => (
            <div key={t.slug} className="rounded-lg border border-border/40 bg-background/40 p-3 text-xs space-y-1.5">
              <div className="font-semibold text-sm">{t.tab ?? t.slug}</div>
              <div className="text-muted-foreground">
                In scope: {t.skus.filter((s) => s.in_scope).map((s) => `${s.column}${s.name ? ` ${s.name}` : ''}`).join(', ') || 'none'}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {t.keys.map((k) => (
                  <span key={k.id} className="inline-flex items-center gap-1.5">
                    <span className="font-mono">{k.id}</span>
                    <KeyState keyState={k} />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
