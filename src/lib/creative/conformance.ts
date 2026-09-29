/**
 * Before a kit is used, Vesper proves it reads it the way the repository does.
 *
 * `kit/conformance.json` carries vectors the plugin's builder wrote with the
 * repository's own code: the verdict for every single and pair of failed
 * checks of every product, and comment lines written by the grammar. A kit
 * whose vectors this code cannot reproduce is refused, and the last good kit
 * stays in use.
 */

import { formatLine, parseLine, type LineFields } from './grammar'
import { verdictFromKit } from './ladder'
import type { Conformance, Kit } from './kit-schema'

export function runConformance(kit: Kit, conformance: Conformance): string[] {
  const problems: string[] = []
  if (conformance.version !== kit.version) {
    problems.push(`conformance.json is for ${conformance.version}, the kit is ${kit.version}`)
  }
  for (const slug of Object.keys(kit.products)) {
    if (!conformance.products[slug]) problems.push(`conformance.json has no vectors for ${slug}`)
  }
  for (const [slug, vectors] of Object.entries(conformance.products)) {
    const product = kit.products[slug]
    if (!product) {
      problems.push(`conformance.json names ${slug}, which the kit does not carry`)
      continue
    }
    let wrong = 0
    for (const v of vectors.ladder) {
      const got = verdictFromKit(kit.ladder, product.rubric.checks, v.failed)
      if (got !== v.verdict) {
        wrong += 1
        if (wrong <= 3) problems.push(`${slug}: failing [${v.failed.join(', ')}] gives ${got}, the repo says ${v.verdict}`)
      }
    }
    if (wrong > 3) problems.push(`${slug}: ${wrong - 3} more ladder vectors differ`)
  }
  for (const v of conformance.comment_lines) {
    try {
      const line = formatLine(v.fields as unknown as LineFields)
      if (line !== v.line) problems.push(`comment line differs: wrote ${JSON.stringify(line)}, the repo wrote ${JSON.stringify(v.line)}`)
      const parsed = parseLine(v.line)
      if (!parsed || parsed.prefix !== kit.comment_line.prefix) {
        problems.push(`comment line ${JSON.stringify(v.line)} does not read back with the prefix ${kit.comment_line.prefix}`)
      }
    } catch (err) {
      problems.push(`comment line ${JSON.stringify(v.line)}: ${(err as Error).message}`)
    }
  }
  return problems
}
