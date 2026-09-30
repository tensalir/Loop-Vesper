/**
 * The CMF team project's shape, pure: its key, name and session, what counts as a CMF render, and
 * which generations the move of the renders Claude made so far takes. `team-records.ts` keeps the
 * records; `scripts/cmf-team-project.ts` moves the old renders, and imports only this, so it needs
 * no part of the web app.
 */

export const CMF_TEAM_KEY = 'cmf'
export const CMF_TEAM_NAME = 'CMF'
export const CMF_TEAM_DESCRIPTION = "The CMF team's renders, from Claude and from the CMF Studio. Everyone with CMF access sees them."
export const CMF_TEAM_SESSION = { name: 'CMF', type: 'image' as const }

// ------------------------------------------------------------------ what a CMF render is

type Json = Record<string, unknown>

function obj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
}

/** A render the CMF engine made, through either door: `cmf_render`, product cmf. */
export function isCmfRender(parameters: unknown): boolean {
  const p = obj(parameters)
  return !!p && p.toolName === 'cmf_render' && obj(p.creative)?.product === 'cmf'
}

/**
 * A generation whose `parameters.creative` names a CMF tab or key: every render the Claude door
 * made (and any earlier CMF draw that recorded one). The data move selects by this.
 */
export function namesCmfTabOrKey(parameters: unknown): boolean {
  const p = obj(parameters)
  const c = obj(p?.creative)
  if (!p || !c) return false
  if (p.toolName !== 'cmf_render' && c.product !== 'cmf') return false
  return (typeof c.tab === 'string' && c.tab.length > 0) || (typeof c.key === 'string' && c.key.length > 0)
}

// ------------------------------------------------------------------ the move of the Claude renders

export interface MoveCandidate {
  generationId: string
  userId: string
  parameters: unknown
  sessionId: string
  projectId: string
  projectSystemKey: string | null
}

export interface MovePlan {
  /** Generations to move into the team session. */
  move: MoveCandidate[]
  /** CMF renders left where they are, and why. */
  leave: Array<{ generationId: string; why: string }>
}

/**
 * Which generations the data move takes: CMF renders (their `parameters.creative` names a CMF tab
 * or key) that sit in a maker's private "Claude" project. One already in the team project stays;
 * one someone moved into a project of their own is left there and named.
 */
export function planCmfMove(rows: MoveCandidate[], teamProjectId: string | null): MovePlan {
  const plan: MovePlan = { move: [], leave: [] }
  for (const r of rows) {
    if (!namesCmfTabOrKey(r.parameters)) continue
    if (teamProjectId && r.projectId === teamProjectId) continue
    if (r.projectSystemKey !== 'claude') {
      plan.leave.push({ generationId: r.generationId, why: `in project ${r.projectId}, not a "Claude" project: moved by hand, left there` })
      continue
    }
    plan.move.push(r)
  }
  return plan
}
