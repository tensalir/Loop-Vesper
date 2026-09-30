import { webVerdict } from '@/lib/creative/cmf/web-door'

/** POST /api/cmf/v2/verdict: a yes or no with why (record_verdict for product cmf). */
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return webVerdict(request)
}
