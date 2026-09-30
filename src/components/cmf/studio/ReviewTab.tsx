'use client'

/**
 * Review: every render of the team's, from the CMF Studio and from Claude, with its grade (the
 * kit's grader, read against the upload the render was made from), every answer given on it, and
 * a yes or no with why. Only the answer of a decider the kit names counts for a supplier PDF, and
 * each answer says whether it does.
 */

import { useState } from 'react'
import { Loader2, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toViewUrl } from '@/lib/storage/refs'
import { useGradeRender, useRecordAnswer, type CmfGradeAnswer, type CmfListing, type CmfTeamRender, type CmfVerdictAnswer } from '@/hooks/useCmf'
import { Door, Empty, gradeWords, Panel, Refusal, when } from './parts'

export function ReviewTab({ listing }: { listing: CmfListing }) {
  if (listing.renders.length === 0) return <Empty>No render has been made yet, in the CMF Studio or in Claude.</Empty>
  const deciders = listing.deciders.length ? listing.deciders.join(' or ') : null
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        {deciders
          ? `Anyone with CMF access can answer. Only ${deciders}'s latest answer counts for a supplier PDF.`
          : 'The product kit names no CMF decider yet, so no answer counts for a supplier PDF.'}{' '}
        The grade is Vesper&apos;s reading of the render against the sheet row and the clown; it helps, it does not decide.
      </p>
      {listing.renders.map((r) => (
        <RenderReview key={r.output_id} render={r} />
      ))}
    </div>
  )
}

function RenderReview({ render: r }: { render: CmfTeamRender }) {
  const grade = useGradeRender()
  const answer = useRecordAnswer()
  const [remark, setRemark] = useState('')
  const [last, setLast] = useState<CmfVerdictAnswer | null>(null)
  const graded: CmfGradeAnswer | undefined = grade.data

  async function give(a: 'yes' | 'no') {
    const got = await answer.mutateAsync({ output_id: r.output_id, grade_id: graded?.grade_id ?? r.grade?.grade_id ?? undefined, answer: a, remark })
    setLast(got)
    setRemark('')
  }

  return (
    <Panel>
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toViewUrl(r.url)} alt={`${r.tab} ${r.column}`} className="w-full rounded-lg border border-border/40" />
        <div className="space-y-3 min-w-0">
          <div className="space-y-1">
            <div className="text-sm font-semibold">
              {r.tab} · column {r.column}
              {r.sku_name ? ` · ${r.sku_name}` : ''}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Door door={r.door} />
              <span>
                {r.made_by ?? 'someone'} · {when(r.made_at)} · key <span className="font-mono">{r.key}</span> · {r.model} ({r.lane}) · kit {r.kit_tag}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Grade:</span>
            {graded ? (
              <span className="font-medium">
                {gradeWords(graded.verdict)} (Vesper, {Array.isArray(graded.reads) ? graded.reads.length : ''} reads)
              </span>
            ) : r.grade ? (
              <span className="font-medium">
                {gradeWords(r.grade.verdict)} ({r.grade.judge === 'vesper' ? 'Vesper' : 'Claude'}, {r.grade.reads} reads, {when(r.grade.at)})
              </span>
            ) : (
              <span className="text-muted-foreground">none yet</span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              disabled={grade.isPending || (!r.import_id && !(r.tab && r.column && r.key))}
              title={r.import_id ? 'Read against the row of the upload it was made from' : "Read against the kit's row"}
              onClick={() =>
                // A render made from an upload is read against that upload's row; one from the kit's own payload, against the kit's.
                grade.mutate(r.import_id ? { output_id: r.output_id, import_id: r.import_id } : { output_id: r.output_id, tab: r.tab!, column: r.column!, clown: r.key! })
              }
            >
              {grade.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
              Grade
            </Button>
          </div>
          <Refusal error={grade.error} />
          {graded && graded.checks.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {graded.checks.map((c) => (
                <li key={c.id}>
                  <span className="font-mono">{c.id}</span> ({c.severity}): {c.caption} · failed in {c.fails} of {c.reads} reads
                </li>
              ))}
            </ul>
          )}
          {graded && graded.checks.length === 0 && graded.status === 'graded' && <p className="text-xs text-muted-foreground">No check failed in any read.</p>}

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Answers:</div>
            {r.answers.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet.</p>
            ) : (
              <ul className="text-xs space-y-1">
                {r.answers.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    <span className="font-medium">{a.answer}</span> from {a.by ?? 'someone'}, {when(a.at)}
                    {a.remark ? `: “${a.remark}”` : ''}
                    {a.decider ? <span className="ml-1.5 text-emerald-700 dark:text-emerald-300">(the decider)</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className={r.pdf_eligible ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-muted-foreground'}>
              {r.pdf_eligible ? 'Can go on a supplier PDF.' : `Not for a supplier PDF: ${r.pdf_why}.`}
            </p>
          </div>

          <div className="space-y-2">
            <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Why (what is right, or what is wrong)" className="min-h-[60px] text-sm" maxLength={2000} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={answer.isPending} onClick={() => give('yes')}>
                Yes
              </Button>
              <Button size="sm" variant="outline" disabled={answer.isPending} onClick={() => give('no')}>
                No
              </Button>
              {answer.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {last && (
                <span className="text-xs text-muted-foreground">
                  Recorded &ldquo;{last.answer}&rdquo; in your name.{' '}
                  {last.decider ? `It counts as ${last.decider}'s answer.` : "It is kept, and does not count as the decider's answer."}
                </span>
              )}
            </div>
            <Refusal error={answer.error} />
          </div>
        </div>
      </div>
    </Panel>
  )
}
