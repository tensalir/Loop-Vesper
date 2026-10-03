/**
 * The Loop kits, schema 1, as Vesper reads them.
 *
 * Two plugins publish a kit in the same shape, each under two names while Loop renames them
 * (the current name first; a kit says which one in `plugin`, and its `tag` starts with that name):
 *   - `ai-studio-design`, until the rename `studio-design` (Loop AI Studio Design,
 *     `tensalir/loop-ai-studio`): Eclipse, packaging and the prompting skill; mirrors
 *     `plugins/<name>/kit.schema.json` there (contract `docs/kit.md`).
 *   - `ai-product-design`, until the rename `product-design` (Loop AI Product Design,
 *     `tensalir/loop-ai-product`, until the rename `tensalir/loop-product-plugins`): CMF, the only
 *     kit Vesper reads CMF from since 2026-09-29. It carries no prompting skill, no Frontify
 *     comment line and no feedback block: those three are null.
 * The Frontify comment line keeps its `studio-design` prefix under either name: it is not renamed.
 *
 * Strict on what Vesper acts on (the schema number, the plugin and its tag, the result rule,
 * severities, verdicts, statuses, checks, pins, the prompting body); open on the rest, so a field
 * a plugin adds does not refuse a kit this code does not read yet. A new `schema` number is
 * refused: the shape changed and this code has not.
 *
 * The two kits name three things differently, and each kit is held to its own names:
 *   (ai-)studio-design    `ladder`    `judges`    `rubric.reporting_only` (true while no check blocks)
 *   (ai-)product-design   `results`   `graders`   `rubric.blocking` (false while no check blocks)
 * Code that serves either kit reads them through `kitResults`, `kitGraders` and `reportsOnly`.
 */

import { z } from 'zod'
import { SEVERITIES, VERDICTS, type KitLadder } from './ladder'

/** The names Loop AI Studio Design's plugin is published under, the current one first. */
export const STUDIO_PLUGINS = ['ai-studio-design', 'studio-design'] as const
/** The names Loop AI Product Design's plugin is published under, the current one first. */
export const PRODUCT_PLUGINS = ['ai-product-design', 'product-design'] as const
export type StudioPlugin = (typeof STUDIO_PLUGINS)[number]
export type ProductPlugin = (typeof PRODUCT_PLUGINS)[number]

/** Whether a plugin name is one of Loop AI Product Design's (the product kit's), old or new. */
export function isProductPlugin(plugin: string): plugin is ProductPlugin {
  return (PRODUCT_PLUGINS as readonly string[]).includes(plugin)
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 in lower-case hex')
const severity = z.enum(SEVERITIES)
const verdict = z.enum(VERDICTS)

export const KitFileSchema = z.object({ path: z.string().min(1), sha256 }).passthrough()

export const KitLadderSchema = z.object({
  ignore: z.array(severity),
  unknown_severity: severity,
  rules: z
    .array(z.object({ severity, at_least: z.number().int().min(1), verdict }).strict())
    .min(1),
  otherwise: verdict,
  rank: z.array(verdict),
})

/** The product kit's name for the same block: how failed checks become a result. */
export const KitResultsSchema = KitLadderSchema

export const KitCheckSchema = z
  .object({
    id: z.string().regex(/^[A-E]\d+$/),
    family: z.string(),
    check: z.string(),
    fails_when: z.string(),
    severity,
    caption: z.string().nullable(),
  })
  .passthrough()

export const KitRubricSchema = z
  .object({
    path: z.string(),
    sha256,
    version: z.string().nullable(),
    // The studio kit says `reporting_only`, the product kit `blocking`; which one a kit must carry
    // is checked per kit (`sayWhetherChecksBlock`).
    reporting_only: z.boolean().optional(),
    blocking: z.boolean().optional(),
    grading_rules: z.string(),
    families: z.array(z.object({ id: z.string(), name: z.string(), note: z.string() }).passthrough()),
    checks: z.array(KitCheckSchema),
    chat_families: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])),
  })
  .passthrough()

export const KitPinSchema = z
  .object({
    id: z.string().min(1),
    source: z.enum(['frontify', 'vesper-storage', 'upload']),
    frontify_asset_id: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    sha256: sha256.nullable(),
    bytes: z.number().int().nullable().optional(),
    width: z.number().int().nullable().optional(),
    height: z.number().int().nullable().optional(),
    roles: z.array(z.string()).default([]),
    generate_roles: z.array(z.string()).optional(),
    colourway: z.string().nullable().optional(),
    model_copy: z.enum(['original', 'derived-4096']).default('original'),
  })
  .passthrough()

const attachMap = z.record(z.record(z.array(z.string())))

export const KitProductSchema = z
  .object({
    name: z.string(),
    aliases: z.array(z.string()),
    kind: z.enum(['product-imagery', 'packaging', 'cmf']),
    skill: z.string(),
    command: z.string(),
    status: z.enum(['scaffold', 'pilot', 'live', 'retired']),
    description: z.string().nullable().optional(),
    vesper_product: z.string().nullable().optional(),
    deciders: z.array(z.record(z.unknown())),
    rubric: KitRubricSchema,
    // Every product's grader shares these; the rest are its own (Eclipse's colourways and
    // views, CMF's parts order, packaging's calibration note) and are checked where they are read,
    // so a kit that adds a grader for a new kind of product is not refused by this schema.
    grading: z
      .object({
        models: z.array(z.string()).min(1),
        runs: z.number().int().min(1),
        temperature: z.number(),
        inline_limit_bytes: z.number().int(),
        max_model_pixels: z.number().int().optional(),
        derived_max_edge: z.number().int().optional(),
        colourways: z.array(z.string()).optional(),
        default_colourway: z.string().optional(),
        views: z.array(z.string()).optional(),
        trusted_claims: z.array(z.string()).optional(),
        reporting_only: z.boolean().optional(),
        blocking: z.boolean().optional(),
        parts_order: z.array(z.string()).optional(),
        calibration: z.string().optional(),
      })
      .passthrough()
      .nullable(),
    grading_prompt: z
      .object({
        template_id: z.string(),
        text: z.record(z.unknown()),
        rules: z.string().optional(),
        anatomy: z.string().optional(),
        first_reference_index: z.number().int().optional(),
        measurement_lines_without_code: z.array(z.string()).optional(),
        parts_file: KitFileSchema.optional(),
      })
      .passthrough()
      .nullable(),
    references: z
      .object({
        pins: z.array(KitPinSchema),
        attach: attachMap,
        not_attached: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    generation: z.record(z.unknown()).nullable(),
    verdicts: z.object({ tool: z.string(), route: z.enum(['frontify-comment', 'vesper']) }).passthrough(),
  })
  .passthrough()

export const KitPromptingSchema = z
  .object({
    skill: z.literal('genai-prompting'),
    edition: z.literal('loop'),
    version: z.string().nullable(),
    skill_body: z.string().min(1),
    sha256,
    references: z.record(KitFileSchema),
    lessons: z.array(z.object({ id: z.string(), lesson: z.string(), evidence: z.string(), held_by: z.string() })),
    router: z.record(z.unknown()).nullable(),
    settings: z.object({ temperature: z.number(), max_tokens: z.number().int() }).passthrough(),
    never_enhance_fingerprints: z.array(z.string().min(8)),
  })
  .passthrough()

export const KitJudgesSchema = z
  .object({
    surfaces: z.array(z.string()).refine((s) => s.includes('vesper'), 'the surfaces must include vesper'),
    vesper_surface: z.literal('vesper'),
    label: z.string(),
    never_pooled: z.literal(true),
  })
  .passthrough()

/** The product kit's name for the same block: the surfaces a grade is read on, never added together. */
export const KitGradersSchema = KitJudgesSchema

export const KitCommentLineSchema = z
  .object({
    prefix: z.literal('studio-design'),
    reads_also: z.array(z.string()),
    separator: z.string(),
    answers: z.array(z.string()),
    verdicts: z.array(z.string()),
    surfaces: z.array(z.string()),
    example: z.string(),
  })
  .passthrough()

export const KitFeedbackSchema = z
  .object({
    repo: z.string(),
    marker: z.string(),
    issue_schema: z.string(),
    title: z.string(),
    bot_variable: z.string(),
    labels: z
      .object({ all: z.string(), kind: z.array(z.string()), skill: z.array(z.string()), state: z.array(z.string()), new: z.string() })
      .passthrough(),
    kinds: z.array(z.enum(['remark', 'bug', 'idea', 'question'])),
    surfaces: z.array(z.string()),
    targets: z
      .array(z.object({ id: z.string(), skill: z.string(), label: z.string(), kind: z.string(), command: z.string() }).passthrough())
      .min(1),
  })
  .passthrough()

/** What every kit carries, whichever plugin wrote it. */
const kitShape = {
  schema: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  repo: z.string(),
  commit: z.null(),
  built_at: z.null(),
  prompting: KitPromptingSchema.nullable(),
  products: z.record(KitProductSchema).refine((p) => Object.keys(p).length > 0, 'the kit names no product'),
  conformance: KitFileSchema,
}

type BlockFlag = 'reporting_only' | 'blocking'

/**
 * Every product of a kit says whether its checks may block, in that kit's word (`flag`), and
 * never in the other kit's (`other`), in its rubric and in its grading.
 */
function sayWhetherChecksBlock(flag: BlockFlag, other: BlockFlag) {
  return (kit: { products: Record<string, KitProduct> }, ctx: z.RefinementCtx) => {
    for (const [slug, p] of Object.entries(kit.products)) {
      if (typeof p.rubric[flag] !== 'boolean') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['products', slug, 'rubric', flag], message: 'Required: true or false' })
      }
      if (p.rubric[other] !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['products', slug, 'rubric', other], message: `this kit says ${flag}` })
      }
      if (p.grading && p.grading[other] !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['products', slug, 'grading', other], message: `this kit says ${flag}` })
      }
    }
  }
}

/**
 * A kit's tag is its own plugin name's: an `ai-studio-design` kit is tagged `ai-studio-design-v*`,
 * a `studio-design` kit `studio-design-v*`, never the other name's.
 */
function tagNamesItsPlugin(kit: { plugin: string; tag: string }, ctx: z.RefinementCtx) {
  const name = kit.tag.replace(/-v\d+\.\d+\.\d+$/, '')
  if (name !== kit.plugin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tag'], message: `the kit is ${kit.plugin}, so its tag is ${kit.plugin}-v<version>, not ${kit.tag}` })
  }
}

/** Loop AI Studio Design's kit: the one Vesper has read since 2026-09-24, under either of its names. */
export const KitSchema = z
  .object({
    ...kitShape,
    plugin: z.enum(STUDIO_PLUGINS),
    tag: z.string().regex(/^(?:ai-)?studio-design-v\d+\.\d+\.\d+$/),
    ladder: KitLadderSchema,
    judges: KitJudgesSchema,
    comment_line: KitCommentLineSchema,
    feedback: KitFeedbackSchema,
  })
  .passthrough()
  .superRefine(tagNamesItsPlugin)
  .superRefine(sayWhetherChecksBlock('reporting_only', 'blocking'))

/** Loop AI Product Design's kit: CMF, under either of its names. No comment line and no feedback block of its own. */
export const ProductKitSchema = z
  .object({
    ...kitShape,
    plugin: z.enum(PRODUCT_PLUGINS),
    tag: z.string().regex(/^(?:ai-)?product-design-v\d+\.\d+\.\d+$/),
    results: KitResultsSchema,
    graders: KitGradersSchema,
    comment_line: z.null().optional(),
    feedback: z.null().optional(),
  })
  .passthrough()
  .superRefine(tagNamesItsPlugin)
  .superRefine(sayWhetherChecksBlock('blocking', 'reporting_only'))

export type Kit = z.infer<typeof KitSchema>
export type ProductKit = z.infer<typeof ProductKitSchema>
/** Either kit: what code that reads only the shared parts (products, the result rule, version, tag) takes. */
export type AnyKit = Kit | ProductKit
export type KitProduct = z.infer<typeof KitProductSchema>
export type KitPin = z.infer<typeof KitPinSchema>
export type KitGraders = z.infer<typeof KitGradersSchema>

/** Whether a kit is the product kit (Loop AI Product Design, CMF), under either of its plugin's names. */
export function isProductKit(kit: AnyKit): kit is ProductKit {
  return isProductPlugin(kit.plugin)
}

/** How failed checks become a result, in either kit: the product kit's `results`, the studio kit's `ladder`. */
export function kitResults(kit: AnyKit): KitLadder {
  return isProductKit(kit) ? kit.results : kit.ladder
}

/** The surfaces a grade is read on, in either kit: the product kit's `graders`, the studio kit's `judges`. */
export function kitGraders(kit: AnyKit): KitGraders {
  return isProductKit(kit) ? kit.graders : kit.judges
}

/**
 * Whether every check only reports, from a rubric or a grading block of either kit: `blocking: false`
 * in the product kit, `reporting_only: true` in the studio kit.
 */
export function reportsOnly(block: { reporting_only?: boolean; blocking?: boolean } | null | undefined): boolean {
  if (!block) return false
  if (typeof block.blocking === 'boolean') return !block.blocking
  return block.reporting_only === true
}

export const ConformanceSchema = z
  .object({
    schema: z.literal(1),
    version: z.string(),
    products: z.record(
      z
        .object({
          // The result-rule vectors: `ladder` from the studio kit, `results` from the product kit.
          // Which one a kit's conformance file must carry is checked in `runConformance`.
          ladder: z.array(z.object({ failed: z.array(z.string()), verdict })).optional(),
          results: z.array(z.object({ failed: z.array(z.string()), verdict })).optional(),
        })
        .passthrough()
    ),
    comment_lines: z.array(z.object({ fields: z.record(z.unknown()), line: z.string() })),
  })
  .passthrough()

export type Conformance = z.infer<typeof ConformanceSchema>
