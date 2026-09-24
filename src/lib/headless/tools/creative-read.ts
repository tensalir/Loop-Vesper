/**
 * The read-only creative tools: what the kit says, which products Vesper
 * serves, and which pinned references a grade or a draw attaches.
 *
 * Every result carries the kit's version, tag and commit, and says when the
 * kit is stale (the newest could not be read or was refused, and this is the
 * last good one).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCreativeKit } from '@/lib/creative/kit-runtime'
import { kitHeader, kitSection, listProducts, referencePlan } from '@/lib/creative/tool-views'
import { pinStorage, prismaPinStore } from '@/lib/creative/pins-runtime'
import type { McpContent } from '../generate-asset'
import { invalidArguments, type ToolContext, type ToolHandler } from './types'

const MAX_PREVIEWS = 5

async function ownerIsAdmin(ownerId: string): Promise<boolean> {
  try {
    const profile = await prisma.profile.findUnique({ where: { id: ownerId }, select: { role: true } })
    return profile?.role === 'admin'
  } catch {
    return false
  }
}

function callable(ctx: ToolContext): (tool: string) => boolean {
  const allowed = new Set<string>(ctx.principal.allowedTools)
  return (tool) => allowed.has(tool)
}

const GetCreativeKitArgs = z.object({
  section: z
    .string()
    .regex(/^(summary|products|prompting|feedback|rubric:[\w -]+)$/, 'summary, products, prompting, feedback or rubric:<product>')
    .default('summary'),
})

export const getCreativeKitHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = GetCreativeKitArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const loaded = await getCreativeKit({ env: ctx.env })
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const { text, structured } = kitSection(loaded, parsed.data.section, callable(ctx), { isAdmin })
    return { content: [{ type: 'text', text }], structuredContent: structured }
  },
}

export const listCreativeProductsHandler: ToolHandler = {
  async run(_args, ctx) {
    const loaded = await getCreativeKit({ env: ctx.env })
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const products = listProducts(loaded.kit, callable(ctx), { isAdmin })
    const lines = products.map(
      (p) =>
        `- ${p.name} (${p.slug}, ${p.status}, ${p.command}): rubric ${p.rubric_version ?? '?'}${p.reporting_only ? ', reporting only' : ''}; ` +
        `${p.colourways.length ? `colourways ${p.colourways.join(', ')}; ` : ''}${p.looks.length ? `looks ${p.looks.join(', ')}; ` : ''}` +
        `decides: ${p.deciders.map((d) => d.name || d.role).join(', ') || 'to name'}; answers go to ${p.verdict_route === 'vesper' ? 'Vesper' : 'Frontify, as a comment line'}` +
        `${p.tools.length ? `; tools: ${p.tools.join(', ')}` : ''}.`
    )
    const header = kitHeader(loaded)
    return {
      content: [
        {
          type: 'text',
          text: `Loop products in creative kit ${loaded.kit.version}${loaded.stale ? ' (stale)' : ''}:\n${lines.join('\n')}`,
        },
      ],
      structuredContent: { ...header, products },
    }
  },
}

const GetProductReferencesArgs = z.object({
  product: z.string().min(1),
  purpose: z.enum(['grade', 'generate']).default('grade'),
  colourway: z.string().max(40).optional(),
  view: z.string().max(40).optional(),
  look: z.string().max(40).optional(),
  scene: z.string().max(40).optional(),
  clown: z.string().max(80).optional(),
  previews: z.boolean().default(true),
})

export const getProductReferencesHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = GetProductReferencesArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const q = parsed.data
    const loaded = await getCreativeKit({ env: ctx.env })
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const rows = await prismaPinStore.list()
    const plan = referencePlan(loaded.kit, q, rows, { isAdmin })

    const content: McpContent[] = []
    const keyText = Object.entries(plan.key).map(([k, v]) => `${k} ${v}`).join(', ')
    const lines = plan.references.map(
      (r) => `${r.n}. ${r.title ?? r.pin_id}${r.roles.length ? ` (${r.roles.join(', ')})` : ''}${r.usable ? '' : ` — NOT USABLE: ${r.why_not}`}`
    )
    content.push({
      type: 'text',
      text:
        `What a ${q.purpose === 'grade' ? 'grade' : 'draw'} of ${plan.product} (${keyText}) attaches, in this order` +
        `${q.purpose === 'generate' ? ', the product render first' : ', after the candidate'}:\n${lines.join('\n')}` +
        `${plan.assumed.length ? `\nAssumed: ${plan.assumed.join('; ')}.` : ''}` +
        `${plan.missing.length ? `\nNot attached: ${plan.missing.join('; ')}.` : ''}` +
        `\nPreviews below are JPEG previews of exactly these pictures, not the originals.`,
    })

    if (q.previews) {
      const storage = pinStorage(ctx.env)
      let shown = 0
      for (const ref of plan.references) {
        if (!ref.usable || shown >= MAX_PREVIEWS) continue
        const row = rows.find((r) => r.pinId === ref.pin_id && r.sha256 === ref.sha256)
        if (!row?.previewPath) continue
        const bytes = await storage.get(row.previewPath).catch(() => null)
        if (!bytes) continue
        content.push({ type: 'text', text: `${ref.n}. ${ref.title ?? ref.pin_id}:` })
        content.push({ type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' })
        shown += 1
      }
    }
    return { content, structuredContent: { ...kitHeader(loaded), ...plan } }
  },
}
