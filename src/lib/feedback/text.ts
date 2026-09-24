/**
 * A colleague's words on their way into a GitHub issue: what may not go in
 * (a secret), and what must not be able to act once it is there (a mention,
 * an issue link, a hidden marker, a heading or a code fence that would change
 * how the triage reads the issue).
 *
 * The secret patterns are the plugin's own (`tools/feedback_triage.py`
 * `_SECRETS` in tensalir/loop-asset-reviewer): the triage withholds the same
 * shapes before its model reads an issue, so a secret Vesper let through would
 * still stop there, and one Vesper refuses never reaches the repository at all.
 */

export interface SecretPattern {
  /** What it looks like, in plain words, for the refusal. The value is never repeated. */
  name: string
  re: RegExp
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'an Anthropic API key (sk-ant-…)', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'an OpenAI API key (sk-…)', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'a GitHub token (ghp_…, gho_…, ghs_…)', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'a GitHub fine-grained token (github_pat_…)', re: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'a Google API key (AIza…)', re: /AIza[0-9A-Za-z_-]{35}/ },
  // A signed token has three dot-separated parts. A Frontify asset id is one
  // base64 run with no dot (eyJpZGVudGlmaWVyIjo…), so it never matches.
  { name: 'a signed token (a JWT: eyJ... in three dot-separated parts)', re: /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/ },
  { name: 'a Vesper token (vsp_live_…, vsp_oat_…, vsp_ort_…)', re: /vsp_(?:live|oat|ort)_[0-9A-Za-z_]{20,}/ },
  { name: 'a private key (-----BEGIN … PRIVATE KEY-----)', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'an AWS access key (AKIA…)', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'a Slack token (xoxb-…)', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
]

export interface SecretFound {
  field: string
  pattern: string
}

/** The first field holding something shaped like a secret, or null. */
export function findSecret(fields: Record<string, string | readonly string[] | null | undefined>): SecretFound | null {
  for (const [field, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v !== 'string' || !v) continue
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(v)) return { field, pattern: p.name }
      }
    }
  }
  return null
}

const ZWSP = '\u200B'
// Control characters other than tab and newline.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Carriage returns folded, control characters removed: the text as it will be stored. */
export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '')
}

/**
 * Words a person wrote, made inert for an issue body or title:
 * - `@name` cannot mention, and `#123` cannot link (a zero-width space follows the sign);
 * - `<!--` and `-->` become entities, so nobody can plant the feedback marker or a triage marker;
 * - a line starting `#` cannot become a heading, and three backticks cannot open a fence, either
 *   of which would change the sections the triage reads.
 */
export function neutralise(text: string | null | undefined): string {
  return clean(text)
    .replace(/@(?=[A-Za-z0-9_-])/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/<!--/g, '&lt;!--')
    .replace(/-->/g, '--&gt;')
    .replace(/^([ \t]*)#/gm, '$1\\#')
    .replace(/```/g, `\`${ZWSP}\`${ZWSP}\``)
}

/** Cut to `max` characters, marking the cut. */
export function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** One line: whitespace folded. */
export function oneLine(text: string): string {
  return clean(text).replace(/\s+/g, ' ').trim()
}

/** The first words of a remark, cut on a word boundary at `max` characters. */
export function firstWords(text: string, max: number): string {
  const line = oneLine(text)
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}
