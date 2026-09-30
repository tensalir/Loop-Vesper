import { webPrompt } from '@/lib/creative/cmf/web-door'

/** POST /api/cmf/v2/prompt: the exact prompt a render sends (cmf_prompt's). */
export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return webPrompt(request)
}
