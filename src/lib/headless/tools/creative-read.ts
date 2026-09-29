/**
 * The read-only creative tools: what the kits say, which products Vesper
 * serves, and which pinned references a grade or a draw attaches.
 *
 * Two kits serve the products (`src/lib/creative/kit-set.ts`): CMF comes from
 * the product kit (Loop Product Design), everything else from the creative kit
 * (Loop Studio Design). Every result carries the version, tag and commit of the
 * kit it read, and says when that kit is stale (the newest could not be read or
 * was refused, and this is the last good one).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { productionKitSet } from '@/lib/creative/kit-runtime'
import { loadKitSet, resolveInKits, type KitSetState } from '@/lib/creative/kit-set'
import { cap, kitHeader, kitSection, listProducts, referencePlan } from '@/lib/creative/tool-views'
import { pinStorage, prismaPinStore } from '@/lib/creative/pins-runtime'
import type { McpContent } from '../generate-asset'
import { invalidArguments, type ToolContext, type ToolHandler } from './types'

const MAX_PREVIEWS = 5

export async function ownerIsAdmin(ownerId: string): Promise<boolean> {
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

/** What the kit summary and product list add about the other kit: where CMF comes from, or why it cannot. */
function otherKitNote(set: KitSetState): { text: string; structured: Record<string, unknown> } {
  const notes: string[] = []
  const structured: Record<string, unknown> = { product_kit: set.product ? kitHeader(set.product) : null }
  if (set.product) {
    notes.push(
      `CMF comes from Loop Product Design's kit ${set.product.kit.version} (${set.product.ref}, commit ${set.product.commit.slice(0, 7)})${set.product.stale ? ` — STALE: ${set.product.staleReason}` : ''}.`
    )
  } else if (set.productError) {
    notes.push(`CMF is unavailable: ${set.productError.message}`)
    structured.product_kit_error = set.productError.message
  }
  if (set.studioError) {
    notes.push(`The creative kit is unavailable: ${set.studioError.message}`)
    structured.creative_kit_error = set.studioError.message
  }
  return { text: notes.join('\n'), structured }
}

export const getCreativeKitHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = GetCreativeKitArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const section = parsed.data.section
    if (section.startsWith('rubric:')) {
      // A rubric is read from the kit that serves the product: CMF's from the product kit.
      const hit = await resolveInKits(productionKitSet(ctx.env), section.slice('rubric:'.length), { isAdmin })
      const { text, structured } = kitSection(hit.loaded, `rubric:${hit.slug}`, callable(ctx), { isAdmin })
      return { content: [{ type: 'text', text }], structuredContent: structured }
    }
    const set = await loadKitSet(productionKitSet(ctx.env))
    const primary = set.studio ?? set.product!
    const { text, structured } = kitSection(primary, section, callable(ctx), { isAdmin })
    if (section !== 'summary' && section !== 'products') {
      return { content: [{ type: 'text', text }], structuredContent: structured }
    }
    const note = otherKitNote(set)
    if (section === 'products' && set.studio && set.product) {
      const products = [...listProducts(set.studio.kit, callable(ctx), { isAdmin }), ...listProducts(set.product.kit, callable(ctx), { isAdmin })]
      return {
        content: [{ type: 'text', text: `${cap(JSON.stringify(products, null, 2))}\n${note.text}` }],
        structuredContent: { ...structured, products, ...note.structured },
      }
    }
    return {
      content: [{ type: 'text', text: note.text ? `${text}\n${note.text}` : text }],
      structuredContent: { ...structured, ...note.structured },
    }
  },
}

export const listCreativeProductsHandler: ToolHandler = {
  async run(_args, ctx) {
    const set = await loadKitSet(productionKitSet(ctx.env))
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const products = [
      ...(set.studio ? listProducts(set.studio.kit, callable(ctx), { isAdmin }) : []),
      ...(set.product ? listProducts(set.product.kit, callable(ctx), { isAdmin }) : []),
    ]
    const lines = products.map(
      (p) =>
        `- ${p.name} (${p.slug}, ${p.status}, ${p.command}): rubric ${p.rubric_version ?? '?'}${p.reporting_only ? ', no check blocks yet' : ''}; ` +
        `${p.colourways.length ? `colourways ${p.colourways.join(', ')}; ` : ''}${p.looks.length ? `looks ${p.looks.join(', ')}; ` : ''}` +
        `decides: ${p.deciders.map((d) => d.name || d.role).join(', ') || 'to name'}; answers go to ${p.verdict_route === 'vesper' ? 'Vesper' : 'Frontify, as a comment line'}` +
        `${p.tools.length ? `; tools: ${p.tools.join(', ')}` : ''}.`
    )
    const header = set.studio ? kitHeader(set.studio) : {}
    const kits = [
      set.studio ? `creative kit ${set.studio.kit.version}${set.studio.stale ? ' (stale)' : ''}` : null,
      set.product ? `product kit ${set.product.kit.version}${set.product.stale ? ' (stale)' : ''}` : null,
    ].filter(Boolean)
    const note = otherKitNote(set)
    return {
      content: [
        {
          type: 'text',
          text: `Loop products in ${kits.join(' and ')}:\n${lines.join('\n')}${set.studioError || set.productError ? `\n${note.text}` : ''}`,
        },
      ],
      structuredContent: { ...header, ...note.structured, products },
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
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    // The kit that serves the product: a CMF clown is the product kit's.
    const { loaded } = await resolveInKits(productionKitSet(ctx.env), q.product, { isAdmin })
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
