/**
 * The creative kit, schema 1, as Vesper reads it.
 *
 * Mirrors `plugins/creative/kit.schema.json` in the plugin repository
 * (`tensalir/loop-asset-reviewer`, contract in `docs/kit.md`). Strict on what
 * Vesper acts on (the schema number, the ladder, severities, verdicts,
 * statuses, checks, pins, the prompting body); open on the rest, so a field
 * the plugin adds does not refuse a kit this code does not read yet. A new
 * `schema` number is refused: the shape changed and this code has not.
 */

import { z } from 'zod'
import { SEVERITIES, VERDICTS } from './ladder'

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
    reporting_only: z.boolean(),
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
    grading: z
      .object({
        models: z.array(z.string()).min(1),
        runs: z.number().int().min(1),
        temperature: z.number(),
        inline_limit_bytes: z.number().int(),
        max_model_pixels: z.number().int(),
        derived_max_edge: z.number().int(),
        colourways: z.array(z.string()),
        default_colourway: z.string(),
        views: z.array(z.string()),
        trusted_claims: z.array(z.string()),
      })
      .passthrough()
      .nullable(),
    grading_prompt: z
      .object({
        template_id: z.string(),
        text: z.record(z.unknown()),
        anatomy: z.string(),
        rules: z.string(),
        first_reference_index: z.number().int(),
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

export const KitSchema = z
  .object({
    schema: z.literal(1),
    plugin: z.literal('creative'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    tag: z.string().regex(/^creative-v\d+\.\d+\.\d+$/),
    repo: z.string(),
    commit: z.null(),
    built_at: z.null(),
    prompting: KitPromptingSchema.nullable(),
    ladder: KitLadderSchema,
    judges: z
      .object({
        surfaces: z.array(z.string()).refine((s) => s.includes('vesper'), 'the surfaces must include vesper'),
        vesper_surface: z.literal('vesper'),
        label: z.string(),
        never_pooled: z.literal(true),
      })
      .passthrough(),
    comment_line: z
      .object({
        prefix: z.literal('creative'),
        reads_also: z.array(z.string()),
        separator: z.string(),
        answers: z.array(z.string()),
        verdicts: z.array(z.string()),
        surfaces: z.array(z.string()),
        example: z.string(),
      })
      .passthrough(),
    products: z.record(KitProductSchema).refine((p) => Object.keys(p).length > 0, 'the kit names no product'),
    feedback: z
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
      .passthrough(),
    conformance: KitFileSchema,
  })
  .passthrough()

export type Kit = z.infer<typeof KitSchema>
export type KitProduct = z.infer<typeof KitProductSchema>
export type KitPin = z.infer<typeof KitPinSchema>

export const ConformanceSchema = z
  .object({
    schema: z.literal(1),
    version: z.string(),
    products: z.record(
      z
        .object({
          ladder: z.array(z.object({ failed: z.array(z.string()), verdict })),
        })
        .passthrough()
    ),
    comment_lines: z.array(z.object({ fields: z.record(z.unknown()), line: z.string() })),
  })
  .passthrough()

export type Conformance = z.infer<typeof ConformanceSchema>
