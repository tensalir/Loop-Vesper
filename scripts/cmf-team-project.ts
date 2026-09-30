/**
 * Moves the CMF renders Claude made so far into the CMF team project, once, after the migration
 * 20260930120000_cmf_team_records is applied. Dry run by default: it says what it would do and
 * changes nothing.
 *
 *   npx tsx scripts/cmf-team-project.ts                      the plan, nothing written
 *   npx tsx scripts/cmf-team-project.ts --apply              do it
 *   npx tsx scripts/cmf-team-project.ts --apply --owner <profile id>
 *                                                            the team project's owner, when it has
 *                                                            to be made (default: the oldest admin)
 *
 * What it does, idempotent (a second run moves nothing):
 *   1. finds the team project (`projects.system_key = 'cmf'`), or makes it, owned by --owner or the
 *      oldest active admin; projects cascade with their owner, so pick a profile that stays;
 *   2. finds or makes its session "CMF", visible to the members;
 *   3. makes every active profile with CMF access (or an admin) a member;
 *   4. moves every generation whose `parameters.creative` names a CMF tab or key out of its maker's
 *      "Claude" project into that session. Outputs, grades and answers follow their generation and
 *      are not touched; the generation keeps its maker. A CMF render someone moved into a project
 *      of their own is left there and named. Empty "CMF" sessions in the Claude projects are left.
 *
 * It needs DATABASE_URL (the one the app uses) and prints ids and counts, never a credential.
 */

import { PrismaClient } from '@prisma/client'
import { CMF_TEAM_DESCRIPTION, CMF_TEAM_KEY, CMF_TEAM_NAME, CMF_TEAM_SESSION, planCmfMove, type MoveCandidate } from '../src/lib/creative/cmf/team-project'

const prisma = new PrismaClient()

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function describe(parameters: unknown): string {
  const c = ((parameters as Record<string, any>)?.creative ?? {}) as Record<string, unknown>
  return `${c.tab ?? '?'} ${c.column ?? '?'} through ${c.key ?? '?'}${(c.workbook as Record<string, unknown> | undefined)?.import_id ? `, upload ${(c.workbook as Record<string, unknown>).import_id}` : ''}`
}

async function main() {
  const apply = process.argv.includes('--apply')
  const ownerArg = arg('--owner')
  console.log(apply ? 'Applying.' : 'Dry run: nothing is written. Add --apply to do it.')

  // 1. The team project.
  let team = await prisma.project.findFirst({ where: { systemKey: CMF_TEAM_KEY }, orderBy: { createdAt: 'asc' }, select: { id: true, ownerId: true } })
  const teams = await prisma.project.count({ where: { systemKey: CMF_TEAM_KEY } })
  if (teams > 1) console.log(`Warning: ${teams} team projects exist; the oldest, ${team!.id}, is used. Move the others' sessions into it by hand.`)
  if (!team) {
    const owner = ownerArg
      ? await prisma.profile.findFirst({ where: { id: ownerArg, pausedAt: null, deletedAt: null }, select: { id: true } })
      : await prisma.profile.findFirst({ where: { role: 'admin', pausedAt: null, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (!owner) throw new Error(ownerArg ? `no active profile ${ownerArg}` : 'no active admin to own the team project; pass --owner <profile id>')
    console.log(`The team project does not exist; ${apply ? 'making' : 'would make'} it, owned by ${owner.id}.`)
    if (apply) {
      team = await prisma.project.create({
        data: { ownerId: owner.id, name: CMF_TEAM_NAME, description: CMF_TEAM_DESCRIPTION, systemKey: CMF_TEAM_KEY, isShared: false },
        select: { id: true, ownerId: true },
      })
    }
  } else {
    console.log(`The team project is ${team.id}, owned by ${team.ownerId}.`)
  }

  // 2. Its session.
  let session = team
    ? await prisma.session.findFirst({ where: { projectId: team.id, name: CMF_TEAM_SESSION.name, type: CMF_TEAM_SESSION.type }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    : null
  if (!session) {
    console.log(`Its session "${CMF_TEAM_SESSION.name}" does not exist; ${apply ? 'making' : 'would make'} it, visible to the members.`)
    if (apply && team) session = await prisma.session.create({ data: { projectId: team.id, name: CMF_TEAM_SESSION.name, type: CMF_TEAM_SESSION.type, isPrivate: false }, select: { id: true } })
  }

  // 3. The members: every active profile with CMF access.
  const people = await prisma.profile.findMany({
    where: { pausedAt: null, deletedAt: null, OR: [{ cmfAccess: true }, { role: 'admin' }] },
    select: { id: true },
  })
  const already = team ? new Set((await prisma.projectMember.findMany({ where: { projectId: team.id }, select: { userId: true } })).map((m) => m.userId)) : new Set<string>()
  const joining = people.filter((p) => p.id !== team?.ownerId && !already.has(p.id))
  console.log(`${people.length} profile(s) have CMF access; ${joining.length} ${apply ? 'become' : 'would become'} members.`)
  if (apply && team && joining.length) {
    await prisma.projectMember.createMany({ data: joining.map((p) => ({ projectId: team!.id, userId: p.id, role: 'editor' })), skipDuplicates: true })
  }

  // 4. The renders.
  const rows = await prisma.generation.findMany({
    where: { OR: [{ parameters: { path: ['toolName'], equals: 'cmf_render' } }, { parameters: { path: ['creative', 'product'], equals: 'cmf' } }] },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true, parameters: true, sessionId: true, session: { select: { projectId: true, project: { select: { systemKey: true } } } }, _count: { select: { outputs: true } } },
  })
  const candidates: MoveCandidate[] = rows.map((r) => ({
    generationId: r.id,
    userId: r.userId,
    parameters: r.parameters,
    sessionId: r.sessionId,
    projectId: r.session.projectId,
    projectSystemKey: r.session.project.systemKey,
  }))
  const plan = planCmfMove(candidates, team?.id ?? null)
  const outputs = new Map(rows.map((r) => [r.id, r._count.outputs]))
  const fromProjects = new Set(plan.move.map((m) => m.projectId))
  console.log(
    `${rows.length} CMF generation(s) found. ${plan.move.length} (${plan.move.reduce((n, m) => n + (outputs.get(m.generationId) ?? 0), 0)} output(s)) ${apply ? 'move' : 'would move'} from ${fromProjects.size} "Claude" project(s) into the team project; ${plan.leave.length} left where they are.`
  )
  for (const m of plan.move) console.log(`  move ${m.generationId}  by ${m.userId}  ${describe(m.parameters)}`)
  for (const l of plan.leave) console.log(`  leave ${l.generationId}: ${l.why}`)
  if (apply && session && plan.move.length) {
    const ids = plan.move.map((m) => m.generationId)
    for (let i = 0; i < ids.length; i += 500) {
      await prisma.generation.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data: { sessionId: session.id } })
    }
    const now = new Date()
    await prisma.session.update({ where: { id: session.id }, data: { updatedAt: now } })
    await prisma.project.update({ where: { id: team!.id }, data: { updatedAt: now } })
    console.log(`Moved ${ids.length} generation(s).`)
  }
  if (!apply) console.log('Nothing was written.')
}

main()
  .catch((err) => {
    console.error((err as Error)?.message || err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
