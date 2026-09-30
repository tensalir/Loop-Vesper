import { webList } from '@/lib/creative/cmf/web-door'

/**
 * GET /api/cmf/v2/list[?tab=]: the CMF listing (cmf_list's): the kit's tabs, SKUs, keys and ready
 * prompts, the newest uploads, and the team's renders and supplier PDFs from both doors.
 * The door is src/lib/creative/cmf/web-door.ts; the step is the CMF service's.
 */
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return webList(request)
}
