import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHeadlessHandler, readJsonBody } from '@/lib/headless/handler'
import { enhancePrompt } from '@/lib/prompts/enhance'
import { HeadlessEnhanceSchema } from '@/lib/api/validation'

/**
 * POST /api/headless/v1/prompts/enhance
 *
 * Bearer-token-authenticated enhancement endpoint. Returns the same
 * Gen-AI prompting craft as the UI route, plus a `skill` block so the
 * caller can pin/audit the substrate version that produced the output.
 */

export const dynamic = 'force-dynamic'

export const POST = withHeadlessHandler(
  {
    surface: 'rest',
    route: '/api/headless/v1/prompts/enhance',
    tool: 'enhance_prompt',
  },
  async (ctx) => {
    const raw = await readJsonBody(ctx.request)
    const parsed = HeadlessEnhanceSchema.safeParse(raw)
    if (!parsed.success) {
      const err = new Error('Invalid request body') as Error & { status?: number }
      err.status = 400
      throw err
    }

    ctx.setModelId(parsed.data.modelId)
    ctx.setMetadata({
      hasReferenceImage: Boolean(parsed.data.referenceImage),
    })

    const result = await enhancePrompt(parsed.data)

    return {
      body: {
        originalPrompt: result.originalPrompt,
        enhancedPrompt: result.enhancedPrompt,
        modelId: result.modelId,
        enhancementModel: result.enhancementModel,
        enhancementPromptId: result.enhancementPromptId,
        skill: result.skill,
      },
    }
  }
)

// Disallow GET so probes get a clean response instead of leaking auth errors.
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed. POST a JSON body to this endpoint.' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
