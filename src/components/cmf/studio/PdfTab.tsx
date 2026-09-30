'use client'

/**
 * PDF: the supplier PDF, built by code from one upload's cells and one approved render per SKU
 * column, read back and checked against the cells before it is saved. Only a render the kit's
 * decider said yes to, made from this upload through a confirmed key, can go on it; the Review
 * tab says why any other cannot. Every supplier PDF of the team's is listed, from either door.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, FileCheck2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toViewUrl } from '@/lib/storage/refs'
import { useCheckPdf, useCmfUpload, useMakeSupplierPdf, type CmfListing } from '@/hooks/useCmf'
import { CheckRows, Door, Empty, Panel, Picker, Refusal, short, when } from './parts'

export function PdfTab({ listing, importId }: { listing: CmfListing; importId: string | null }) {
  const { data: view } = useCmfUpload(importId)
  const tabs = useMemo(() => (view?.tabs ?? []).filter((t) => t.slug), [view])
  const [tab, setTab] = useState('')
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.tab === tab)) setTab(tabs[0].tab)
  }, [tabs, tab])
  const make = useMakeSupplierPdf()

  // The renders that can go on this PDF: made from this upload, of this tab, with the decider's yes.
  const eligible = listing.renders.filter((r) => r.pdf_eligible && r.import_id === importId && r.tab === tab)
  const byColumn = useMemo(() => {
    const m = new Map<string, typeof eligible>()
    for (const r of eligible) m.set(r.column ?? '?', [...(m.get(r.column ?? '?') ?? []), r])
    return m
  }, [eligible])
  const [picked, setPicked] = useState<Record<string, string>>({})
  const chosen = Array.from(byColumn.keys())
    .sort()
    .map((col) => ({ col, out: picked[col] ?? '' }))
    .filter((x) => x.out)

  if (!importId) return <Empty>Upload a workbook first (Workbook tab): a supplier PDF is built from an upload&apos;s cells.</Empty>

  return (
    <div className="space-y-4">
      <Panel
        title="Make the supplier PDF"
        hint="Pick one render per SKU column. Only renders made from this upload, answered yes by the decider, through a confirmed key, are offered. Renders made the old way never are."
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            disabled={make.isPending || chosen.length === 0 || !importId}
            onClick={() => make.mutate({ import_id: importId!, tab, sku_columns: chosen.map((c) => c.col), output_ids: chosen.map((c) => c.out) })}
          >
            {make.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="h-3.5 w-3.5" />}
            Make the PDF
          </Button>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Picker label="Tab" value={tab} options={tabs.map((t) => ({ value: t.tab, label: t.tab }))} onChange={setTab} />
        </div>
        {byColumn.size === 0 ? (
          <Empty>No render of {tab || 'this tab'} from this upload can go on a supplier PDF yet. The Review tab says why for each.</Empty>
        ) : (
          <div className="space-y-3">
            {Array.from(byColumn.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([col, renders]) => (
                <div key={col} className="space-y-1.5">
                  <div className="text-xs font-medium">
                    Column {col}
                    {renders[0]?.sku_name ? ` · ${renders[0].sku_name}` : ''}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setPicked((p) => ({ ...p, [col]: '' }))}
                      className={`h-28 w-28 rounded-lg border text-[11px] text-muted-foreground ${!picked[col] ? 'border-primary' : 'border-border/40'}`}
                    >
                      Leave out
                    </button>
                    {renders.map((r) => (
                      <button
                        type="button"
                        key={r.output_id}
                        onClick={() => setPicked((p) => ({ ...p, [col]: r.output_id }))}
                        className={`relative h-28 w-28 overflow-hidden rounded-lg border-2 ${picked[col] === r.output_id ? 'border-primary' : 'border-transparent'}`}
                        title={`${r.decider_answer?.by} said yes, ${when(r.decider_answer?.at)}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={toViewUrl(r.url)} alt={`${r.tab} ${r.column}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
        <Refusal error={make.error} />
        {make.data && (
          <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/5 p-3 text-xs space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{make.data.file_name}</span>
              <a href={toViewUrl(make.data.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary">
                Open <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
            <p>
              Read back and checked before it was saved: {make.data.cells_compared} cells and every other printed value ({make.data.rows_compared} rows), all equal to the workbook&apos;s cells.
            </p>
            <p className="text-muted-foreground">
              Workbook {make.data.workbook.file}, sha256 {short(make.data.workbook.sha256)}, modified {make.data.workbook.modified} ({make.data.workbook.modified_source}). Legend from the key {make.data.key.id}, confirmed by{' '}
              {make.data.key.confirmed_by}.
            </p>
            <ul className="text-muted-foreground">
              {make.data.renders.map((x) => (
                <li key={x.column}>
                  {x.column}: answered yes by {x.decided_by} on {x.decided_at.slice(0, 10)}
                </li>
              ))}
            </ul>
            {make.data.listed_error && <p className="text-amber-700 dark:text-amber-200">Not listed for the team ({make.data.listed_error}); the PDF is safe at the link.</p>}
          </div>
        )}
      </Panel>

      <Panel title="Supplier PDFs made" hint="The team's, newest first, from the CMF Studio and from Claude.">
        {listing.supplier_pdfs.length === 0 ? (
          <Empty>No supplier PDF has been made yet.</Empty>
        ) : (
          <ul className="space-y-2 text-xs">
            {listing.supplier_pdfs.map((p) => (
              <li key={p.supplier_pdf_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="font-medium truncate">{p.file}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                    <Door door={p.door} /> {p.made_by ?? 'someone'} · {when(p.made_at)} · {p.tab} {p.columns.join(', ')} · key <span className="font-mono">{p.key}</span>
                  </div>
                </div>
                <a href={toViewUrl(p.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary">
                  Open <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CheckAnyPdf listing={listing} />
    </div>
  )
}

/** Any CMF PDF (a supplier's copy, a PDF made the old way) against its sheet cells. */
function CheckAnyPdf({ listing }: { listing: CmfListing }) {
  const check = useCheckPdf()
  const [url, setUrl] = useState('')
  const [tab, setTab] = useState(listing.tabs[0]?.tab ?? '')
  const [columns, setColumns] = useState('')
  return (
    <Panel title="Check a PDF against the sheet" hint="Every value printed on a CMF PDF against its cell in the kit's copy of the sheet. A PDF that is not clean does not go out.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground grow min-w-[16rem]">
          <span className="font-medium uppercase tracking-wider text-[10px]">PDF link (Vesper storage)</span>
          <input className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm text-foreground" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <Picker label="Tab" value={tab} options={listing.tabs.map((t) => ({ value: t.tab ?? t.slug, label: t.tab ?? t.slug }))} onChange={setTab} />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wider text-[10px]">Columns (optional)</span>
          <input className="h-9 w-32 rounded-md border border-border/60 bg-background px-2 text-sm text-foreground" value={columns} onChange={(e) => setColumns(e.target.value)} placeholder="D, E" />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={check.isPending || !url || !tab}
          onClick={() =>
            check.mutate({
              pdf_url: url.trim(),
              tab,
              ...(columns.trim() ? { columns: columns.split(/[,\s]+/).filter(Boolean).map((c) => c.toUpperCase()) } : {}),
            })
          }
        >
          {check.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Check'}
        </Button>
      </div>
      <Refusal error={check.error} />
      {check.data && (
        <div className="space-y-2 text-xs">
          <p className={check.data.clean ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-200'}>
            {check.data.clean
              ? `Clean: every value matches the sheet (${check.data.cells_compared} cells compared).`
              : `Not clean: this PDF must not go out. ${Object.entries(check.data.counts)
                  .filter(([k, n]) => k !== 'match' && n > 0)
                  .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
                  .join(', ')}.`}
          </p>
          {!check.data.clean && <CheckRows rows={check.data.rows.filter((r) => r.state !== 'match') as unknown as Array<Record<string, unknown>>} />}
          {check.data.notes.map((n) => (
            <p key={n} className="text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      )}
    </Panel>
  )
}
