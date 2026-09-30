import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/api/auth'
import { handleStorageRequest } from '@/lib/storage/browser-route'

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
        return user ? null : { status: statusCode ?? 401, error: error || 'Unauthorized' }
      },
    }
  )
}

export const GET = serve
export const HEAD = serve
