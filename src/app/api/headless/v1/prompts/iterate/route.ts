import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHeadlessHandler, readJsonBody } from '@/lib/headless/handler'
import { iteratePrompt } from '@/lib/prompts/iterate'
import { HeadlessIterateSchema } from '@/lib/api/validation'

/**
 * POST /api/headless/v1/prompts/iterate
 *
 * Bearer-token-authenticated Andromeda-aware iteration slate endpoint.
 * Returns the structured slate JSON the Gen-AI prompting skill defines
 * in its Iteration Slate Mode.
 */

export const dynamic = 'force-dynamic'

export const POST = withHeadlessHandler(
  {
    surface: 'rest',
    route: '/api/headless/v1/prompts/iterate',
    tool: 'iterate_prompt',
  },
  async (ctx) => {
    const raw = await readJsonBody(ctx.request)
    const parsed = HeadlessIterateSchema.safeParse(raw)
    if (!parsed.success) {
      const err = new Error('Invalid request body') as Error & { status?: number }
      err.status = 400
      throw err
    }

    ctx.setModelId(parsed.data.modelId)
    ctx.setMetadata({
      hasReferenceImage: Boolean(parsed.data.referenceImage),
      variantCount: parsed.data.variantCount,
      anchorKeys: Object.keys(parsed.data.anchors ?? {}),
    })

    const result = await iteratePrompt(parsed.data)

    return {
      body: {
        slate: result.slate,
        variantCount: result.variantCount,
        modelId: result.modelId,
        enhancementModel: result.enhancementModel,
        skill: result.skill,
      },
    }
  }
)

export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed. POST a JSON body to this endpoint.' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
