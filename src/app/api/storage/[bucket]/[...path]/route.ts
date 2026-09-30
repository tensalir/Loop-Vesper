import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { handleStorageRequest } from '@/lib/storage/browser-route'
import { mediaAccessProblem } from '@/lib/storage/media-access'

/**
 * GET /api/storage/<bucket>/<path>: a stored render, video or product render for a signed-in
 * person, as a redirect to a short signature (or a resized copy with `?w=`).
 * See src/lib/storage/browser-route.ts.
 */

export const dynamic = 'force-dynamic'

type Params = { params: { bucket: string; path: string[] } }

async function serve(request: NextRequest, { params }: Params): Promise<Response> {
  return handleStorageRequest(
    { bucket: params.bucket, path: params.path, searchParams: request.nextUrl.searchParams },
    {
      async authenticate() {
        const { user, error, statusCode } = await getAuthUser()
        if (!user) return { status: statusCode ?? 401, error: error || 'Unauthorized' }
        // Signed in is not enough: sign-up is not gated, so a Loop address (confirmed) or admin.
        const profile = await prisma.profile.findUnique({ where: { id: user.id }, select: { role: true } })
        const problem = mediaAccessProblem(user, profile?.role)
        return problem ? { status: 403, error: problem } : null
      },
    }
  )
}

export const GET = serve
export const HEAD = serve
