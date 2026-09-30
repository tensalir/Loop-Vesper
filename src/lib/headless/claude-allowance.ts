/**
 * A daily allowance per person for the work Claude pays for through Vesper, and for the CMF
 * renders and grades the web CMF Studio pays for, which share it.
 *
 * Loop accounts connect Claude without an admin step (src/lib/oauth/claude-access.ts), so the
 * spend control is a count per person over any rolling 24 hours, checked on the MCP surface
 * before anything is paid for:
 *
 *   CLAUDE_DAILY_IMAGE_LIMIT  default 40: images drawn by generate_asset, generate_product_image,
 *                             cmf_render and packaging_finish; a video from generate_video counts
 *                             as one.
 *   CLAUDE_DAILY_GRADE_LIMIT  default 120: model reads by grade_image (a grade is three reads
 *                             unless `runs` says otherwise).
 *
 * Admins are not limited by the count. `tools/call` on the MCP surface checks it (./mcp-dispatch.ts),
 * and so does the web CMF Studio, for its renders and grades (`door: 'web'`,
 * src/lib/creative/cmf/web-door.ts): a CMF render or grade costs the same whichever door asks, so
 * the two doors share one count per person, not one each (owner, 2026-09-30). The rest of the web
 * app is not limited. `0` is the kill switch: through Claude that kind of work stops for everyone,
 * admins included, since the shared organisation token is owned by an admin; in the CMF Studio it
 * stops for everyone but admins, who are people there, not a shared token. A refusal is an ordinary
 * `isError` tool result (a 429 in the web) that says how many were used, the limit, and roughly
 * when the next one frees up.
 *
 * Counted from records Vesper already writes, not from a counter of its own:
 *   images  `generations` marked `parameters.source = 'mcp'` by recordMcpGeneration, one per
 *           output, leaving out the packaging mockup (built in code, model 'none', no model spend),
 *           and the CMF renders the web CMF Studio made (`source = 'web'`, `toolName = 'cmf_render'`);
 *   reads   `creative_grades` by Vesper's own judge ('vesper'), their `reads`, from either door
 *           (Claude's own look, record_grade, is judge 'chat' and costs nothing);
 * plus calls still running (`headless_mcp_jobs` queued, or processing and not stale, and the CMF
 * Studio's `cmf_web_jobs` still processing) at what they asked for, so a call sees the draws still
 * in flight. Calls checked at the same instant,
 * before either has its job row, can both pass: the limit can be passed by what those calls ask
 * for (four images at most each), within the per-credential rate limit.
 *
 * Not counted: a draw whose record could not be written, a packaging draw the flow discarded
 * (paid for, no output kept), and prompt rewrites (enhance_prompt, iterate_prompt), which are
 * text calls. The USD cap in ./cost-cap.ts, when set, still covers every tool with an estimate.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MAX_RUNS } from '@/lib/creative/grade'
import { STALE_PROCESSING_MS } from './jobs'
import type { HeadlessTool } from './tool-registry'
import { prismaCmfWebJobStore } from '@/lib/creative/cmf/web-jobs'

export type AllowanceKind = 'image' | 'grade'

export interface AllowanceNeed {
  kind: AllowanceKind
  /** Images (or videos) this call asks for, or grading reads. */
  units: number
  /** A video, which counts as one image. */
  video?: boolean
}

export const WINDOW_MS = 24 * 60 * 60 * 1000

export const DEFAULT_DAILY_LIMITS: Record<AllowanceKind, number> = { image: 40, grade: 120 }

const LIMIT_ENV: Record<AllowanceKind, string> = {
  image: 'CLAUDE_DAILY_IMAGE_LIMIT',
  grade: 'CLAUDE_DAILY_GRADE_LIMIT',
}

function units(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.floor(value)))
}

/**
 * Every MCP tool that spends model money, and what one call asks for, read from its arguments
 * before it runs (a call's own clamping can only lower it). `tests/claude-allowance.spec.ts`
 * holds this list to the tools that estimate a cost, so a new paid tool cannot skip it.
 */
export const CLAUDE_ALLOWANCE: Partial<Record<HeadlessTool, (args: Record<string, unknown>) => AllowanceNeed>> = {
  generate_asset: (a) => ({ kind: 'image', units: units(a.numOutputs, 1, 4) }),
  generate_video: () => ({ kind: 'image', units: 1, video: true }),
  generate_product_image: (a) => ({ kind: 'image', units: units(a.n, 1, 4) }),
  cmf_render: (a) => ({ kind: 'image', units: units(a.n, 1, 4) }),
  packaging_finish: (a) => ({ kind: 'image', units: units(a.n, 1, 4) }),
  grade_image: (a) => ({ kind: 'grade', units: units(a.runs, 3, MAX_RUNS) }),
}

export function allowanceNeed(toolName: string, args: Record<string, unknown>): AllowanceNeed | null {
  const need = CLAUDE_ALLOWANCE[toolName as HeadlessTool]
  return need ? need(args) : null
}

function toolsOfKind(kind: AllowanceKind): string[] {
  return Object.entries(CLAUDE_ALLOWANCE)
    .filter(([, need]) => need?.({}).kind === kind)
    .map(([tool]) => tool)
}

/** The limit for a kind: the env value when it is a whole number of 0 or more, else the default. */
export function claudeDailyLimit(kind: AllowanceKind, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[LIMIT_ENV[kind]]
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_LIMITS[kind]
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_LIMITS[kind]
}

/** The door a piece of work came through: Claude's, or the web CMF Studio's. */
export type AllowanceDoor = 'mcp' | 'web'

/** One counted piece of work: when it was made (or started), how many units it holds, and through which door. */
export interface CountedWork {
  at: Date
  units: number
  /** Unset means Claude's. */
  door?: AllowanceDoor
}

export type AllowanceUsage = (input: { ownerId: string; kind: AllowanceKind; since: Date; now: Date }) => Promise<CountedWork[]>

export type AllowanceDecision =
  | { ok: true }
  | {
      ok: false
      kind: AllowanceKind
      used: number
      limit: number
      requested: number
      /** When enough frees up for this call; null when the call asks for more than the limit. */
      freesAt: Date | null
      message: string
    }

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function whenText(at: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 60_000))
  const clock = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')} UTC`
  const wait = minutes < 60 ? plural(minutes, 'minute', 'minutes') : plural(Math.round(minutes / 60), 'hour', 'hours')
  return `around ${clock} (in about ${wait})`
}

export function allowanceMessage(input: {
  kind: AllowanceKind
  used: number
  limit: number
  requested: number
  freesAt: Date | null
  video?: boolean
  now: Date
  /** The door asking; the web's wording names the CMF Studio. */
  door?: AllowanceDoor
  /** Whether work from the CMF Studio is in the count, so the count names both doors. */
  bothDoors?: boolean
}): string {
  const { kind, used, limit, requested, freesAt, now } = input
  const image = kind === 'image'
  const web = input.door === 'web'
  const nothing = image ? 'Nothing was made or paid for.' : 'Nothing was read or paid for.'
  if (limit === 0) {
    if (web) {
      return `${image ? 'Rendering' : 'Grading'} in the CMF Studio is switched off on this Vesper right now. ${nothing} Ask a Vesper admin if you need it.`
    }
    return image
      ? `Making images and videos through Claude is switched off on this Vesper right now. ${nothing} The Vesper web app is not affected; ask a Vesper admin if you need it.`
      : `Grading through Claude is switched off on this Vesper right now. ${nothing} Ask a Vesper admin if you need it.`
  }
  const through = web || input.bothDoors ? 'through Claude and the CMF Studio together' : 'through Claude'
  const noun = image ? 'images' : 'grading reads'
  const unit = image ? (input.video ? 'video' : 'image') : 'read'
  const note = image ? (input.video ? ' (a video counts as one image)' : '') : ' (a grade is usually three reads)'
  if (requested > limit) {
    return `This call asks for ${plural(requested, unit, `${unit}s`)}, more than the ${limit} ${noun} a person can use ${through} in 24 hours. Ask for ${limit} or fewer. ${nothing}`
  }
  const when = freesAt ? whenText(freesAt, now) : 'within 24 hours'
  const left = Math.max(0, limit - used)
  if (left === 0) {
    return `You have used ${used} of your ${limit} ${noun} ${through} in the last 24 hours${note}, so this call was not run. ${nothing} The next one frees up ${when}. Ask a Vesper admin if you need more today.`
  }
  return `You have used ${used} of your ${limit} ${noun} ${through} in the last 24 hours${note}, and this call asks for ${requested}. Ask for ${left} or fewer now, or wait: enough frees up ${when}. ${nothing}`
}

export async function checkClaudeAllowance(input: {
  ownerId: string
  isAdmin: boolean
  need: AllowanceNeed
  env?: NodeJS.ProcessEnv
  now?: Date
  usage?: AllowanceUsage
  /** The door asking: Claude's (the default) or the web CMF Studio's. Both count the same work. */
  door?: AllowanceDoor
}): Promise<AllowanceDecision> {
  const { need } = input
  const door = input.door ?? 'mcp'
  const now = input.now ?? new Date()
  const limit = claudeDailyLimit(need.kind, input.env)
  let bothDoors = door === 'web'
  const refuse = (used: number, freesAt: Date | null): AllowanceDecision => ({
    ok: false,
    kind: need.kind,
    used,
    limit,
    requested: need.units,
    freesAt,
    message: allowanceMessage({ kind: need.kind, used, limit, requested: need.units, freesAt, video: need.video, now, door, bothDoors }),
  })
  // Through Claude the switch stops admins too (the shared organisation token is an admin's); in
  // the CMF Studio an admin is a person, exempt from the count as always.
  if (limit === 0 && (door === 'mcp' || !input.isAdmin)) return refuse(0, null)
  if (input.isAdmin) return { ok: true }

  const since = new Date(now.getTime() - WINDOW_MS)
  const work = (await (input.usage ?? prismaAllowanceUsage)({ ownerId: input.ownerId, kind: need.kind, since, now }))
    .filter((w) => w.at.getTime() >= since.getTime() && w.units > 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  bothDoors = bothDoors || work.some((w) => w.door === 'web')
  const used = work.reduce((sum, w) => sum + w.units, 0)
  if (used + need.units <= limit) return { ok: true }
  if (need.units > limit) return refuse(used, null)

  // Oldest first: the moment enough has left the window for this call to fit.
  let remaining = used
  let freesAt: Date | null = null
  for (const w of work) {
    remaining -= w.units
    if (remaining + need.units <= limit) {
      freesAt = new Date(w.at.getTime() + WINDOW_MS)
      break
    }
  }
  return refuse(used, freesAt)
}

/** Calls still running for this kind: queued ones will still run; processing ones unless their worker is lost. */
async function runningWork(ownerId: string, kind: AllowanceKind, since: Date, now: Date): Promise<CountedWork[]> {
  const jobs = await prisma.headlessMcpJob.findMany({
    where: {
      ownerId,
      toolName: { in: toolsOfKind(kind) },
      createdAt: { gte: since },
      OR: [
        { status: 'queued' },
        { status: 'processing', updatedAt: { gte: new Date(now.getTime() - STALE_PROCESSING_MS) } },
      ],
    },
    select: { createdAt: true, toolName: true, request: true },
  })
  const mcp: CountedWork[] = jobs.map((job) => {
    const request = job.request && typeof job.request === 'object' ? (job.request as Record<string, unknown>) : {}
    return { at: job.createdAt, units: allowanceNeed(job.toolName, request)?.units ?? 1, door: 'mcp' }
  })
  // The CMF Studio's renders still drawing (its grades wait in the request, so none run on).
  const web: CountedWork[] =
    kind === 'image'
      ? (await prismaCmfWebJobStore.running({ ownerId, toolName: 'cmf_render', since, now })).map((job) => ({
          at: job.createdAt,
          units: allowanceNeed(job.toolName, job.request)?.units ?? 1,
          door: 'web',
        }))
      : []
  return [...mcp, ...web]
}

/**
 * The generations that count as images, by door: everything Claude drew (`source = 'mcp'`), and
 * the CMF renders the CMF Studio drew (`source = 'web'`, `toolName = 'cmf_render'`), the same draw
 * as cmf_render's. The rest of the web app's generations do not count. `imageDoorOf` is the same
 * rule on a record in hand; `tests/claude-allowance.spec.ts` holds the two together.
 */
export const COUNTED_IMAGES: ReadonlyArray<{ door: AllowanceDoor; where: Prisma.GenerationWhereInput }> = [
  { door: 'mcp', where: { parameters: { path: ['source'], equals: 'mcp' } } },
  { door: 'web', where: { AND: [{ parameters: { path: ['source'], equals: 'web' } }, { parameters: { path: ['toolName'], equals: 'cmf_render' } }] } },
]

/** The door a generation's images count under, or null when they do not count. */
export function imageDoorOf(generation: { modelId: string; parameters: unknown }): AllowanceDoor | null {
  if (generation.modelId === 'none') return null
  const p = (generation.parameters && typeof generation.parameters === 'object' ? generation.parameters : {}) as Record<string, unknown>
  if (p.source === 'mcp') return 'mcp'
  if (p.source === 'web' && p.toolName === 'cmf_render') return 'web'
  return null
}

export const prismaAllowanceUsage: AllowanceUsage = async ({ ownerId, kind, since, now }) => {
  const running = await runningWork(ownerId, kind, since, now)
  if (kind === 'image') {
    const counted = await Promise.all(
      COUNTED_IMAGES.map(async ({ door, where }) => {
        const rows = await prisma.generation.findMany({
          where: { userId: ownerId, createdAt: { gte: since }, modelId: { not: 'none' }, ...where },
          select: { createdAt: true, _count: { select: { outputs: true } } },
        })
        return rows.map((g): CountedWork => ({ at: g.createdAt, units: g._count.outputs, door }))
      })
    )
    return [...counted.flat(), ...running]
  }
  // Every grade by Vesper's own judge, from either door: a web grade has no credential.
  const grades = await prisma.creativeGrade.findMany({
    where: { ownerId, judge: 'vesper', createdAt: { gte: since } },
    select: { createdAt: true, reads: true, credentialId: true },
  })
  return [...grades.map((g): CountedWork => ({ at: g.createdAt, units: g.reads, door: g.credentialId ? 'mcp' : 'web' })), ...running]
}
