/**
 * The decider's answer as the one comment line the repository's nightly pull reads
 * (`tools/feedback_grammar.py`, ported in `grammar.ts`):
 *
 *   [creative eclipse 2026-10-02] no | decoded B3 | grade PASS_WITH_NOTES B3 | judge gemini-flash-latest vesper x3 | rubric 0.5.3 | the strap stops at the ear
 *
 * The date is the day the answer was given in Brussels, where the studio is. The grade is the one
 * the answer responds to (Vesper's `vesper x<reads>`, or Claude's own `chat x1`); an answer to a
 * picture nobody graded says `grade -` and names the judge that read it for the person.
 * Vesper never posts the line: the person's own Frontify connector does, so it is theirs.
 */

import { formatLine } from './grammar'

export function brusselsDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export interface GradeForLine {
  verdict: string | null
  failed: string[]
  judgeModel: string | null
  surface: 'vesper' | 'chat'
  reads: number
  rubricVersion: string | null
}

export interface VerdictLineInput {
  product: string
  answer: 'yes' | 'no'
  remark: string
  decoded: string[]
  decodedUnconfirmed: string[]
  grade: GradeForLine | null
  rubricVersion: string | null
  /** When no grade exists: the model that read it for the person (Claude's). */
  fallbackJudge?: string | null
  at: Date
}

function word(v: string | null | undefined, fallback: string): string {
  const s = String(v ?? '').trim().replace(/\s+/g, '-')
  return s || fallback
}

export function verdictLine(input: VerdictLineInput): string {
  const g = input.grade
  const verdict = g && g.verdict && g.verdict !== 'ERROR' ? g.verdict : null
  return formatLine({
    product: input.product,
    date: brusselsDate(input.at),
    answer: input.answer,
    remark: input.remark,
    decoded: input.decoded,
    decoded_unconfirmed: input.decodedUnconfirmed,
    verdict,
    failed: verdict ? g!.failed : [],
    judge: word(g ? g.judgeModel : input.fallbackJudge, g ? 'gemini' : 'claude'),
    surface: g ? g.surface : 'chat',
    reads: g ? Math.max(1, g.reads) : 1,
    rubric: word(g?.rubricVersion ?? input.rubricVersion, '-'),
  })
}
