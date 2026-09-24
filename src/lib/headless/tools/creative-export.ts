/**
 * `export_creative_records`: the grades, answers and draw manifests the plugin repository reads back
 * nightly into its `record/feedback/`. Issued only on a static credential an admin makes for the
 * repository's GitHub Actions secret; no person's connection carries it.
 *
 * The same rows are served at `GET /api/headless/v1/creative/{grades,verdicts,manifests}`.
 */

import { z } from 'zod'
import { exportCreativeRecords, type ExportKind } from '@/lib/creative/records'
import { invalidArguments, type ToolHandler } from './types'

export const EXPORT_MAX = 500

export const ExportArgs = z
  .object({
    kind: z.enum(['grades', 'verdicts', 'manifests']),
    product: z.string().max(80).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(EXPORT_MAX).default(200),
  })
  .strict()

export async function exportRows(input: z.infer<typeof ExportArgs>) {
  const rows = await exportCreativeRecords(input.kind as ExportKind, {
    product: input.product,
    since: input.since ? new Date(input.since) : undefined,
    limit: input.limit,
  })
  const last = rows[rows.length - 1] as { createdAt?: Date; created_at?: Date } | undefined
  const next = last ? (last.createdAt ?? last.created_at ?? null) : null
  return { kind: input.kind, count: rows.length, rows, next_since: next ? new Date(next).toISOString() : null }
}

export const exportCreativeRecordsHandler: ToolHandler = {
  async run(args) {
    const parsed = ExportArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const out = await exportRows(parsed.data)
    return {
      content: [{ type: 'text', text: `${out.count} ${out.kind}${out.next_since ? `; next since ${out.next_since}` : ''}.` }],
      structuredContent: out,
    }
  },
}
