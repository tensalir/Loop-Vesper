import { webRenderJob } from '@/lib/creative/cmf/web-door'

/** GET /api/cmf/v2/render/{job}: a render the person started, still drawing or done. */
export const dynamic = 'force-dynamic'

export function GET(_request: Request, { params }: { params: { jobId: string } }) {
  return webRenderJob(params.jobId)
}
