import { webRender } from '@/lib/creative/cmf/web-door'

/**
 * POST /api/cmf/v2/render: cmf_render's refusals in the request, the daily allowance, then the
 * draw as a job the page polls (GET /api/cmf/v2/render/{job}). The draw runs after the response,
 * for up to about 280 s, so the function is given 300.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export function POST(request: Request) {
  return webRender(request)
}
