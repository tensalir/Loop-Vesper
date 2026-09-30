'use client'

/**
 * Render: pick the tab, the SKU column, the clown key and the lane. The page shows the prompt
 * exactly as it will be sent (Damien's template filled by code from the upload's cells), and the
 * clown is the only image. The render is saved for the whole CMF team; the renders below are the
 * team's, whichever door made them.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toViewUrl } from '@/lib/storage/refs'
import { useCmfPrompt, useCmfRenderJob, useCmfUpload, useStartRender, type CmfListing, type CmfUploadTarget } from '@/hooks/useCmf'
import { Door, Empty, KeyState, Panel, Picker, Refusal, short, when } from './parts'

export function RenderTab({ listing, importId }: { listing: CmfListing; importId: string | null }) {
  const { data: view, error: viewError } = useCmfUpload(importId)
  const tabs = useMemo(() => (view?.tabs ?? []).filter((t) => t.slug), [view])
  const [tab, setTab] = useState('')
  const [column, setColumn] = useState('')
  const [clown, setClown] = useState('')
  const [lane, setLane] = useState<'final' | 'draft'>('final')
  const [jobId, setJobId] = useState<string | null>(null)

  // Defaults follow the upload: its first tab the kit knows, its first SKU in scope, the first key that is not a draft.
  useEffect(() => {
    if (!tabs.length) return
    if (!tabs.some((t) => t.tab === tab)) setTab(tabs[0].tab)
  }, [tabs, tab])
  const current = tabs.find((t) => t.tab === tab) ?? null
  useEffect(() => {
    if (!current) return
    const inScope = current.skus.filter((s) => s.in_scope)
    if (!inScope.some((s) => s.column === column)) setColumn(inScope[0]?.column ?? '')
    if (!current.keys.some((k) => k.id === clown)) setClown(current.keys.find((k) => !k.draft)?.id ?? current.keys[0]?.id ?? '')
  }, [current, column, clown])

  const target: CmfUploadTarget | null = importId && tab && column && clown ? { import_id: importId, tab, sku_column: column, clown } : null
  const prompt = useCmfPrompt(target)
  const start = useStartRender()
  const job = useCmfRenderJob(jobId)
  const key = current?.keys.find((k) => k.id === clown) ?? null
  const ready = prompt.data && !prompt.data.refused
  const drawing = start.isPending || job.data?.status === 'processing' || (jobId !== null && !job.data)

  const teamRenders = listing.renders.filter((r) => !tab || r.tab === tab)

  if (!importId) return <Empty>Upload a workbook first (Workbook tab): a render is made from an upload&apos;s cells.</Empty>

  return (
    <div className="space-y-4">
      <Panel title="What to render" hint="Only a key Damien has named every zone of can make a prompt. A draft key cannot.">
        <Refusal error={viewError} />
        <div className="flex flex-wrap gap-3">
          <Picker label="Tab" value={tab} options={tabs.map((t) => ({ value: t.tab, label: t.tab }))} onChange={setTab} />
          <Picker
            label="Column"
            value={column}
            options={(current?.skus ?? []).map((s) => ({ value: s.column, label: `${s.column}${s.name ? ` · ${s.name}` : ''}${s.in_scope ? '' : ' (not in scope)'}`, disabled: !s.in_scope }))}
            onChange={setColumn}
          />
          <Picker
            label="Clown key"
            value={clown}
            options={(current?.keys ?? []).map((k) => ({ value: k.id, label: `${k.id}${k.draft ? ' (draft)' : k.confirmed ? '' : ' (not confirmed yet)'}`, disabled: k.draft }))}
            onChange={setClown}
          />
          <Picker
            label="Lane"
            value={lane}
            options={[
              { value: 'final', label: 'Final' },
              { value: 'draft', label: 'Draft (faster, cheaper)' },
            ]}
            onChange={setLane}
          />
        </div>
        {key && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            Key <span className="font-mono">{key.id}</span> <KeyState keyState={key} />
          </div>
        )}
      </Panel>

      <Panel
        title="The prompt that will be sent"
        hint="Filled by code from the upload's cells, word for word. It cannot be edited here: a change goes into the workbook or the key."
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!ready || drawing}
            onClick={async () => {
              if (!target) return
              setJobId(null)
              const got = await start.mutateAsync({ ...target, lane })
              setJobId(got.job_id)
            }}
          >
            {drawing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Render
          </Button>
        }
      >
        {prompt.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Refusal error={prompt.error} />
        {prompt.data?.refused && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-100 space-y-1">
            <p>
              No prompt for {prompt.data.tab} column {prompt.data.column} through {prompt.data.key}: the fill refused it. Nothing is sent until the row or the key is fixed.
            </p>
            <ul className="list-disc pl-5">
              {prompt.data.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {prompt.data && !prompt.data.refused && (
          <div className="space-y-3">
            <pre className="whitespace-pre-wrap rounded-lg border border-border/40 bg-background/60 p-3 text-xs leading-relaxed font-mono max-h-[28rem] overflow-y-auto">{prompt.data.prompt}</pre>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-medium">#</th>
                    <th className="py-1 pr-3 font-medium">Zone</th>
                    <th className="py-1 pr-3 font-medium">Component</th>
                    <th className="py-1 pr-3 font-medium">Material</th>
                    <th className="py-1 pr-3 font-medium">Finish</th>
                    <th className="py-1 pr-3 font-medium">Colour</th>
                    <th className="py-1 pr-3 font-medium">Code</th>
                  </tr>
                </thead>
                <tbody>
                  {prompt.data.lines.map((l) => (
                    <tr key={`${l.n}-${l.component}`} className="border-t border-border/30">
                      <td className="py-1 pr-3">{l.n}</td>
                      <td className="py-1 pr-3 font-mono">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5 align-middle border border-border/50" style={{ background: l.zone_hex }} />
                        {l.zone_hex}
                      </td>
                      <td className="py-1 pr-3">{l.component}</td>
                      <td className="py-1 pr-3">{l.material}</td>
                      <td className="py-1 pr-3">{l.finish}</td>
                      <td className="py-1 pr-3">{l.colour_name}</td>
                      <td className="py-1 pr-3 font-mono">{l.colour_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {prompt.data.omitted.length > 0 && <p className="text-xs text-muted-foreground">Left out: {prompt.data.omitted.map((o) => `${o.component} (${o.why})`).join('; ')}.</p>}
            {prompt.data.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-700 dark:text-amber-200">
                Warning: {w}
              </p>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Prompt sha256 <span className="font-mono">{short(prompt.data.prompt_sha256)}</span> · clown <span className="font-mono">{prompt.data.clown.id}</span> ({short(prompt.data.clown.sha256)}), the only image
            </p>
          </div>
        )}
        <Refusal error={start.error} />
        {start.data && (
          <p className="text-xs text-muted-foreground">
            {start.data.plan.model} ({start.data.plan.lane}), {start.data.plan.aspect} at {start.data.plan.image_size}
            {start.data.estimated_cost_usd !== null ? `, about $${start.data.estimated_cost_usd.toFixed(2)}` : ''}.
          </p>
        )}
        {job.data?.status === 'processing' && <p className="text-xs text-muted-foreground">Drawing. This takes up to a few minutes; you can leave the page and find it under Review.</p>}
        {job.data?.status === 'failed' && <Refusal error={new Error(job.data.error ?? 'The render failed.')} />}
        {job.data?.status === 'completed' && job.data.result && (
          <div className="space-y-2">
            {job.data.result.failures.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-200">Not rendered: {job.data.result.failures.join('; ')}.</p>}
            {!job.data.result.recorded && <p className="text-xs text-amber-700 dark:text-amber-200">Not saved for the team ({job.data.result.record_error}); the files are safe at their links.</p>}
            <div className="flex flex-wrap gap-3">
              {job.data.result.outputs.map((o) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={o.url} src={toViewUrl(o.url)} alt={`${job.data!.result!.tab} ${job.data!.result!.column}`} className="h-64 w-auto rounded-lg border border-border/40" />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Saved for the CMF team. Grade it and answer it under Review.</p>
          </div>
        )}
      </Panel>

      <Panel title="The team's renders" hint="From the CMF Studio and from Claude, newest first.">
        {teamRenders.length === 0 ? (
          <Empty>No render of this tab yet.</Empty>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            {teamRenders.map((r) => (
              <figure key={r.output_id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={toViewUrl(r.url)} alt={`${r.tab} ${r.column}`} className="aspect-square w-full rounded-lg border border-border/40 object-cover" />
                <figcaption className="text-[11px] text-muted-foreground space-y-0.5">
                  <div className="text-foreground">
                    {r.column}
                    {r.sku_name ? ` · ${r.sku_name}` : ''}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Door door={r.door} /> {r.made_by ?? ''} · {when(r.made_at)}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
