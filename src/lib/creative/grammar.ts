/**
 * The one line a review answer becomes, as a Frontify comment on the asset.
 *
 *   [creative eclipse 2026-10-02] no | decoded B3 | grade PASS_WITH_NOTES B3 | judge gemini-flash-latest vesper x3 | rubric 0.5.3 | the strap stops at the ear
 *
 * A port of `tools/feedback_grammar.py` in the plugin repository, which the
 * nightly pull reads the answers back with. Lines are written with the
 * `creative` prefix; lines under the older `asset-review` prefix are ours too
 * and parse. The kit's comment-line vectors are run against `formatLine`
 * before a kit is used, so the two cannot drift apart.
 */

export const PREFIXES = ['creative', 'asset-review'] as const
export const WRITE_PREFIX = 'creative'
export const GRAMMAR_VERDICTS = ['PASS', 'PASS_WITH_NOTES', 'RETRY', 'FAIL'] as const
export const SURFACES = ['chat', 'cowork', 'code', 'qa', 'vesper'] as const
export const ANSWERS = ['yes', 'no'] as const
export const SEP = ' | '

export type Surface = (typeof SURFACES)[number]

const HEAD = new RegExp(
  `^\\[(${PREFIXES.join('|')}) ([a-z0-9]+(?:-[a-z0-9]+)*) (\\d{4}-\\d{2}-\\d{2})\\] (yes|no)$`
)
const CHECK = /^[A-Z]\d+$/
const DECODED = /^decoded (-|[A-Z]\d+\??(?:,[A-Z]\d+\??)*)$/
const GRADE = new RegExp(`^grade (-|${GRAMMAR_VERDICTS.join('|')})(?: ([A-Z]\\d+(?:,[A-Z]\\d+)*))?$`)
const JUDGE = new RegExp(`^judge (\\S+) (${SURFACES.join('|')}) x([1-9]\\d*)$`)
const RUBRIC = /^rubric (\S+)$/

export class GrammarError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GrammarError'
  }
}

export interface CommentLine {
  prefix: string
  product: string
  date: string
  answer: 'yes' | 'no'
  decoded: string[]
  decodedUnconfirmed: string[]
  verdict: string | null
  failed: string[]
  judge: string
  surface: Surface
  reads: number
  rubric: string
  remark: string
}

export function isOurs(text: string): boolean {
  const s = text.replace(/^\s+/, '')
  return PREFIXES.some((p) => s.startsWith(`[${p} `))
}

export function head(product: string, date: string): string {
  return `[${WRITE_PREFIX} ${product} ${date}]`
}

/** Python's `str.split(sep, maxsplit)`. */
function splitN(text: string, sep: string, maxsplit: number): string[] {
  const out: string[] = []
  let rest = text
  while (out.length < maxsplit) {
    const i = rest.indexOf(sep)
    if (i < 0) break
    out.push(rest.slice(0, i))
    rest = rest.slice(i + sep.length)
  }
  out.push(rest)
  return out
}

/** The fields of one comment line, or null when it is not ours; throws on ours and malformed. */
export function parseLine(text: string): CommentLine | null {
  const line = text.trim()
  if (!isOurs(line)) return null
  const parts = splitN(line, SEP, 5)
  if (parts.length !== 6) {
    throw new GrammarError(`expected 6 fields, found ${parts.length}: ${JSON.stringify(line.slice(0, 80))}`)
  }
  const [h, d, g, j, r, remark] = parts
  const mh = HEAD.exec(h)
  const md = DECODED.exec(d)
  const mg = GRADE.exec(g)
  const mj = JUDGE.exec(j)
  const mr = RUBRIC.exec(r)
  const names = ['head', 'decoded', 'grade', 'judge', 'rubric']
  const matches = [mh, md, mg, mj, mr]
  matches.forEach((m, i) => {
    if (!m) throw new GrammarError(`${names[i]} does not parse: ${JSON.stringify(parts[i])}`)
  })
  const decoded: string[] = []
  const unconfirmed: string[] = []
  if (md![1] !== '-') {
    for (const token of md![1].split(',')) {
      ;(token.endsWith('?') ? unconfirmed : decoded).push(token.replace(/\?+$/, ''))
    }
  }
  return {
    prefix: mh![1],
    product: mh![2],
    date: mh![3],
    answer: mh![4] as 'yes' | 'no',
    decoded,
    decodedUnconfirmed: unconfirmed,
    verdict: mg![1] === '-' ? null : mg![1],
    failed: mg![2] ? mg![2].split(',') : [],
    judge: mj![1],
    surface: mj![2] as Surface,
    reads: Number(mj![3]),
    rubric: mr![1],
    remark: remark.trim() === '-' ? '' : remark.trim(),
  }
}

export interface LineFields {
  product: string
  date: string
  answer: string
  remark: string
  decoded?: readonly string[]
  decoded_unconfirmed?: readonly string[]
  verdict?: string | null
  failed?: readonly string[]
  judge: string
  surface: string
  reads: number
  rubric: string
}

/** The line, from its fields. Refuses anything that would not parse back. */
export function formatLine(f: LineFields): string {
  if (!(ANSWERS as readonly string[]).includes(f.answer)) {
    throw new GrammarError(`answer must be yes or no, not ${JSON.stringify(f.answer)}`)
  }
  if (!(SURFACES as readonly string[]).includes(f.surface)) {
    throw new GrammarError(`surface must be one of ${SURFACES.join(', ')}, not ${JSON.stringify(f.surface)}`)
  }
  if (f.verdict != null && !(GRAMMAR_VERDICTS as readonly string[]).includes(f.verdict)) {
    throw new GrammarError(`verdict must be one of ${GRAMMAR_VERDICTS.join(', ')} or null, not ${JSON.stringify(f.verdict)}`)
  }
  const decoded = f.decoded ?? []
  const unconfirmed = f.decoded_unconfirmed ?? []
  const failed = f.failed ?? []
  for (const id of [...decoded, ...unconfirmed, ...failed]) {
    if (!CHECK.test(id)) throw new GrammarError(`not a check id: ${JSON.stringify(id)}`)
  }
  if (!/^\S+$/.test(f.judge) || !/^\S+$/.test(f.rubric)) {
    throw new GrammarError('judge and rubric are single words')
  }
  const remark = String(f.remark).split(/\s+/).filter(Boolean).join(' ') || '-'
  const ids = [...decoded, ...unconfirmed.map((c) => `${c}?`)]
  const grade = `grade ${f.verdict ?? '-'}${failed.length ? ` ${failed.join(',')}` : ''}`
  const line = [
    `${head(f.product, f.date)} ${f.answer}`,
    `decoded ${ids.length ? ids.join(',') : '-'}`,
    grade,
    `judge ${f.judge} ${f.surface} x${Math.trunc(f.reads)}`,
    `rubric ${f.rubric}`,
    remark,
  ].join(SEP)
  parseLine(line) // a line that would not read back is never handed to anyone
  return line
}
