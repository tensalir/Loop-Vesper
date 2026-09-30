import { webGrade } from '@/lib/creative/cmf/web-door'

/** POST /api/cmf/v2/grade: the kit's grader on one of the team's renders (grade_image for product cmf). */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export function POST(request: Request) {
  return webGrade(request)
}
