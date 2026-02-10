/**
 * Sigil export to Figma: accepts a LayoutSpec and returns export result.
 * Currently a stub; real implementation will create/update Figma frames via REST API.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { exportLayoutSpecToFigma } from '@/lib/figma/client'
import type { LayoutSpec } from '@/lib/sigil/schema/layoutSpec'

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let spec: LayoutSpec
  try {
    const body = await request.json()
    spec = body.spec as LayoutSpec
    if (!spec?.formatId || !spec?.textBlocks) {
      return NextResponse.json({ error: 'Invalid LayoutSpec' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await exportLayoutSpecToFigma(spec, {
    fileKey: request.nextUrl.searchParams.get('fileKey') ?? undefined,
    parentNodeId: request.nextUrl.searchParams.get('parentNodeId') ?? undefined,
  })

  return NextResponse.json(result)
}
