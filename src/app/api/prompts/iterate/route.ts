import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { classifyError } from '@/lib/errors/classification'
import { validateBody, PromptIterateSchema } from '@/lib/api/validation'
import { enhanceLimiter } from '@/lib/api/rate-limit'
import { iteratePrompt } from '@/lib/prompts/iterate'

/**
 * POST /api/prompts/iterate
 *
 * Cookie-authenticated UI route. Delegates to the shared `iteratePrompt`
 * service. Returns the same shape as before so existing callers keep
 * working: `{ slate, raw, variantCount }`.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limited = enhanceLimiter.check(user.id)
    if (limited) return limited

    const { data, error } = await validateBody(request, PromptIterateSchema)
    if (error) return error

    const result = await iteratePrompt(data)

    return NextResponse.json({
      slate: result.slate,
      raw: result.raw,
      variantCount: result.variantCount,
    })
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number; rawText?: string }
    const errorMsg = err?.message || 'Failed to iterate prompt'
    const classified = classifyError(errorMsg)
    console.error(`Error iterating prompt [${classified.label}]:`, error)

    const anthropicStatus = err?.status || err?.statusCode
    let httpStatus = classified.httpStatus
    let errorCategory: string = classified.category

    if (anthropicStatus === 401) {
      return NextResponse.json(
        { error: 'Invalid API key. Please configure ANTHROPIC_API_KEY', errorCategory: 'auth' },
        { status: 401 }
      )
    }

    if (anthropicStatus === 429) {
      httpStatus = 429
      errorCategory = 'rate_limited'
    } else if (anthropicStatus === 529 || anthropicStatus === 503) {
      httpStatus = 502
      errorCategory = 'upstream_unavailable'
    }

    // Slate parse failures are treated as upstream/internal — the user can retry.
    if (errorMsg.includes('unparseable slate')) {
      return NextResponse.json(
        { error: errorMsg, errorCategory: 'internal' },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to iterate prompt', details: errorMsg, errorCategory },
      { status: httpStatus }
    )
  }
}
