/**
 * Before a kit is used, Vesper proves it reads it the way the repository does.
 *
 * `kit/conformance.json` carries vectors the plugin's builder wrote with the
 * repository's own code: the verdict for every single and pair of failed
 * checks of every product (`ladder` in the studio kit's file, `results` in the
 * product kit's), and comment lines written by the grammar (the
 * studio kit's; the product kit writes no comment line and carries none). A
 * kit whose vectors this code cannot reproduce is refused, and the last good
 * kit stays in use.
 */

import { formatLine, parseLine, type LineFields } from './grammar'
import { verdictFromKit } from './ladder'
import { isProductKit, kitResults, type AnyKit, type Conformance } from './kit-schema'

export function runConformance(kit: AnyKit, conformance: Conformance): string[] {
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
    // The product kit's vectors are `results`, the studio kit's `ladder`: each kit its own name.
    const name = isProductKit(kit) ? 'results' : 'ladder'
    const list = vectors[name]
    if (!list) {
      problems.push(`conformance.json has no ${name} vectors for ${slug}`)
      continue
    }
    const rule = kitResults(kit)
    let wrong = 0
    for (const v of list) {
      const got = verdictFromKit(rule, product.rubric.checks, v.failed)
      if (got !== v.verdict) {
        wrong += 1
        if (wrong <= 3) problems.push(`${slug}: failing [${v.failed.join(', ')}] gives ${got}, the repo says ${v.verdict}`)
      }
    }
    if (wrong > 3) problems.push(`${slug}: ${wrong - 3} more ${name} vectors differ`)
  }
  const commentLine = kit.comment_line ?? null
  if (!commentLine) {
    if (conformance.comment_lines.length) {
      problems.push(`conformance.json carries ${conformance.comment_lines.length} comment lines, and the kit writes none`)
    }
    return problems
  }
  for (const v of conformance.comment_lines) {
    try {
      const line = formatLine(v.fields as unknown as LineFields)
      if (line !== v.line) problems.push(`comment line differs: wrote ${JSON.stringify(line)}, the repo wrote ${JSON.stringify(v.line)}`)
      const parsed = parseLine(v.line)
      if (!parsed || parsed.prefix !== commentLine.prefix) {
        problems.push(`comment line ${JSON.stringify(v.line)} does not read back with the prefix ${commentLine.prefix}`)
      }
    } catch (err) {
      problems.push(`comment line ${JSON.stringify(v.line)}: ${(err as Error).message}`)
    }
  }
  return problems
}
