/**
 * `record_verdict`: a decider's answer to one picture, attributed to the signed-in person and kept
 * with the grade it answers (`creative_verdicts`).
 *
 * Where the answer goes depends on where the picture lives. A Frontify asset of a product whose
 * answers go to Frontify (Eclipse) gets the exact comment line the repository's nightly pull reads;
 * Vesper does not post it: Claude posts it with the person's own Frontify connector, so the comment
 * is theirs. Anything else (a Vesper draw, a packaging or CMF answer) is recorded in Vesper, and the
 * repository reads it through the export.
 */

import { z } from 'zod'
import { productionKitSet } from '@/lib/creative/kit-runtime'
import { resolveInKits } from '@/lib/creative/kit-set'
import { kitHeader } from '@/lib/creative/tool-views'
import { loadCandidate } from '@/lib/creative/candidate'
import { prismaCreativeRecords, type GradeRecord } from '@/lib/creative/records'
import { verdictLine } from '@/lib/creative/verdict-line'
import { productionCandidateDeps } from '@/lib/creative/work-runtime'
import { isCmfRenderOutput, recordCmfVerdict, requireCmf } from '@/lib/creative/cmf/service'
import { ownerIsAdmin } from './creative-read'
import { mcpActor } from './cmf'
import { invalidArguments, type ToolHandler } from './types'

const CHECK_ID = /^[A-E]\d+$/

export const RecordVerdictArgs = z
  .object({
    product: z.string().min(1).max(80),
    grade_id: z.string().uuid().optional(),
    output_id: z.string().uuid().optional(),
    frontify_asset_id: z.string().min(8).max(200).optional(),
    image_url: z.string().url().max(2000).optional(),
    answer: z.enum(['yes', 'no']),
    remark: z.string().max(2000).optional().default(''),
    decoded: z.array(z.string().regex(CHECK_ID)).max(20).default([]),
    decoded_unconfirmed: z.array(z.string().regex(CHECK_ID)).max(20).default([]),
    judge_model: z.string().regex(/^\S{2,80}$/).optional(),
  })
  .strict()

/** What an answer says about the grade it answers. */
function aboutGrade(grade: GradeRecord | null): string {
  return grade
    ? `It answers grade ${grade.id} (${grade.verdict}, judge ${grade.judgeModel ?? '?'} ${grade.judge === 'vesper' ? 'vesper' : 'chat'} x${grade.reads}).`
    : 'No grade of this picture is on record, so the answer stands alone.'
}

export const recordVerdictHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = RecordVerdictArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const a = parsed.data
    if (!a.grade_id && !a.output_id && !a.frontify_asset_id && !a.image_url) {
      throw new Error('name the picture the answer is about: grade_id, output_id, frontify_asset_id or image_url')
    }
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    // CMF from the product kit, the rest from the creative kit (`src/lib/creative/kit-set.ts`).
    const { loaded, slug, product } = await resolveInKits(productionKitSet(ctx.env), a.product, { isAdmin })
    if (product.kind === 'cmf') {
      // A CMF answer is the CMF service's (`src/lib/creative/cmf/service.ts`), the one the web door
      // calls too: it needs CMF access, and it is always recorded in Vesper.
      const got = await recordCmfVerdict(
        mcpActor(ctx),
        {
          loaded,
          grade_id: a.grade_id,
          output_id: a.output_id,
          frontify_asset_id: a.frontify_asset_id,
          image_url: a.image_url,
          answer: a.answer,
          remark: a.remark,
          decoded: a.decoded,
          decoded_unconfirmed: a.decoded_unconfirmed,
        },
        ctx.env
      )
      return {
        content: [{ type: 'text', text: `Recorded the answer "${a.answer}" in Vesper, in your name. ${aboutGrade(got.grade)} The plugin's repository reads it from Vesper; nothing needs posting.` }],
        structuredContent: {
          ...kitHeader(got.loaded),
          verdict_id: got.verdictId,
          product: got.slug,
          answer: a.answer,
          grade_id: got.grade?.id ?? null,
          route: 'vesper',
          comment_line: null,
          frontify_asset_id: got.frontifyAssetId,
        },
      }
    }
    if (a.output_id && (await isCmfRenderOutput(a.output_id))) {
      // A CMF render under another product's name: the CMF gate first, then the product it is.
      await requireCmf(mcpActor(ctx))
      throw new Error(`output ${a.output_id} is a CMF render: record the answer with product cmf`)
    }
    const known = new Set(product.rubric.checks.map((c) => c.id))
    const unknown = [...a.decoded, ...a.decoded_unconfirmed].filter((id) => !known.has(id))
    if (unknown.length) throw new Error(`${product.name}'s rubric has no check ${unknown.join(', ')}`)

    // The grade the answer responds to: the one named, else the newest of this picture.
    let grade: GradeRecord | null = null
    if (a.grade_id) {
      grade = await prismaCreativeRecords.getGrade(a.grade_id)
      if (!grade || grade.product !== slug) throw new Error(`no ${slug} grade '${a.grade_id}'`)
    }
    let imageSha256: string | null = grade?.imageSha256 ?? null
    if (!grade && a.image_url) {
      const candidate = await loadCandidate({ image_url: a.image_url }, ctx.principal.ownerId, productionCandidateDeps(ctx.env))
      imageSha256 = candidate.sha256
    }
    if (!grade) {
      grade = await prismaCreativeRecords.latestGrade({
        product: slug,
        outputId: a.output_id ?? null,
        frontifyAssetId: a.frontify_asset_id ?? null,
        imageSha256,
      })
    }
    const frontifyAssetId = a.frontify_asset_id ?? grade?.frontifyAssetId ?? null
    const toFrontify = product.verdicts.route === 'frontify-comment' && !!frontifyAssetId
    const line = toFrontify
      ? verdictLine({
          product: slug,
          answer: a.answer,
          remark: a.remark,
          decoded: a.decoded,
          decodedUnconfirmed: a.decoded_unconfirmed,
          grade: grade
            ? {
                verdict: grade.verdict,
                failed: grade.failed,
                judgeModel: grade.judgeModel,
                surface: grade.judge === 'vesper' ? 'vesper' : 'chat',
                reads: grade.reads,
                rubricVersion: grade.rubricVersion,
              }
            : null,
          rubricVersion: product.rubric.version,
          fallbackJudge: a.judge_model ?? null,
          at: new Date(),
        })
      : null

    const stored = await prismaCreativeRecords.insertVerdict({
      product: slug,
      profileId: ctx.principal.ownerId,
      credentialId: ctx.principal.credentialId,
      gradeId: grade?.id ?? null,
      outputId: a.output_id ?? grade?.outputId ?? null,
      imageUrl: a.image_url ?? grade?.imageUrl ?? null,
      frontifyAssetId,
      imageSha256: imageSha256 ?? grade?.imageSha256 ?? null,
      answer: a.answer,
      remark: a.remark || null,
      decoded: a.decoded,
      decodedUnconfirmed: a.decoded_unconfirmed,
      route: toFrontify ? 'frontify-comment' : 'vesper',
      commentLine: line,
      kitVersion: loaded.kit.version,
      rubricVersion: product.rubric.version,
    })

    const about = aboutGrade(grade)
    const text = toFrontify
      ? [
          `Recorded the answer "${a.answer}" in Vesper, in your name. ${about}`,
          `Now post this line as a comment on Frontify asset ${frontifyAssetId}, with your own Frontify connector (frontify_create_asset_comment), so the comment is yours:`,
          line!,
          'Do not change the line: the nightly pull reads it back field by field. Moving the asset or tagging it is a separate yes.',
        ].join('\n')
      : `Recorded the answer "${a.answer}" in Vesper, in your name. ${about} The plugin's repository reads it from Vesper; nothing needs posting.`
    return {
      content: [{ type: 'text', text }],
      structuredContent: {
        ...kitHeader(loaded),
        verdict_id: stored.id,
        product: slug,
        answer: a.answer,
        grade_id: grade?.id ?? null,
        route: toFrontify ? 'frontify-comment' : 'vesper',
        comment_line: line,
        frontify_asset_id: frontifyAssetId,
      },
    }
  },
}
