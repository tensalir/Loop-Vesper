import { webKeys } from '@/lib/creative/cmf/web-door'

/** GET /api/cmf/v2/keys: the kit's clown keys and their clowns, read only. */
export const dynamic = 'force-dynamic'

export function GET() {
  return webKeys()
}
