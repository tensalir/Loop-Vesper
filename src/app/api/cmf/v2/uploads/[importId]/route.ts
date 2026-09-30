import { webReadUpload } from '@/lib/creative/cmf/web-door'

/** GET /api/cmf/v2/uploads/{import_id}: an upload's tabs, SKUs by column letter, and each tab's keys. */
export const dynamic = 'force-dynamic'

export function GET(_request: Request, { params }: { params: { importId: string } }) {
  return webReadUpload(params.importId)
}
