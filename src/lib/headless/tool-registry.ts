/**
 * The one registry of headless tools.
 *
 * Before this file, four hand-kept lists decided which tools a credential
 * could reach: the self-issue route, the org-credential route, the admin
 * issue route and the org CLI script. They had drifted (the org route gave
 * five tools, the CLI eight, the admin route four). Every list now derives
 * from `TOOL_META`; the CLI script keeps its own literal list because it runs
 * outside the TypeScript build, and a test holds it to this registry.
 *
 * Static credentials keep the explicit tool list stored on their row, so the
 * behaviour of every token issued before this change is unchanged. A
 * credential whose list is `['*']` (the per-person OAuth credentials of the
 * next change) gets the tools its owner's flags allow, computed per request,
 * so a new tool needs no backfill.
 */

export const HEADLESS_TOOLS = [
  'enhance_prompt',
  'iterate_prompt',
  'list_models',
  'generate_asset',
  'list_product_renders',
  'get_generation_status',
  'generate_video',
  'estimate_generation_cost',
] as const

export type HeadlessTool = (typeof HEADLESS_TOOLS)[number]

export type ToolGroup = 'core' | 'creative' | 'feedback' | 'cmf' | 'packaging'

export interface ToolMeta {
  group: ToolGroup
  /** Profile flag required on top of MCP access ('cmf' → cmfAccess, 'packaging' → packagingAccess). */
  needs?: 'cmf' | 'packaging'
  /** Granted to wildcard (per-person OAuth) credentials when the owner's flags allow. */
  oauth: boolean
  /** Granted to the self-issued token minted from /headless. */
  selfIssued: boolean
  /** Granted to a newly issued organisation-wide token. */
  org: boolean
  /** May be picked by an admin issuing a credential by hand. */
  adminIssuable: boolean
}

export const TOOL_META: Record<HeadlessTool, ToolMeta> = {
  enhance_prompt: { group: 'core', oauth: true, selfIssued: true, org: true, adminIssuable: true },
  iterate_prompt: { group: 'core', oauth: true, selfIssued: true, org: true, adminIssuable: true },
  list_models: { group: 'core', oauth: true, selfIssued: true, org: true, adminIssuable: true },
  generate_asset: { group: 'core', oauth: true, selfIssued: true, org: true, adminIssuable: true },
  list_product_renders: { group: 'core', oauth: true, selfIssued: true, org: true, adminIssuable: true },
  // The org token has never carried the three below. Keeping `org: false`
  // keeps newly issued org tokens identical to the live one; the org token is
  // retired once people sign in one by one.
  get_generation_status: { group: 'core', oauth: true, selfIssued: true, org: false, adminIssuable: true },
  generate_video: { group: 'core', oauth: true, selfIssued: true, org: false, adminIssuable: true },
  estimate_generation_cost: { group: 'core', oauth: true, selfIssued: true, org: false, adminIssuable: true },
}

export function isHeadlessTool(name: string): name is HeadlessTool {
  return (HEADLESS_TOOLS as readonly string[]).includes(name)
}

function toolsWhere(pick: (meta: ToolMeta) => boolean): HeadlessTool[] {
  return HEADLESS_TOOLS.filter((tool) => pick(TOOL_META[tool]))
}

export const SELF_ISSUED_TOOLS: HeadlessTool[] = toolsWhere((m) => m.selfIssued)
export const ORG_DEFAULT_TOOLS: HeadlessTool[] = toolsWhere((m) => m.org)
export const ADMIN_ISSUABLE_TOOLS: HeadlessTool[] = toolsWhere((m) => m.adminIssuable)

/** The subset of a profile the tool policy reads. */
export interface ToolPolicyProfile {
  role?: string | null
  cmfAccess?: boolean | null
  packagingAccess?: boolean | null
}

function ownerHasFlag(needs: ToolMeta['needs'], profile: ToolPolicyProfile | null | undefined): boolean {
  if (!needs) return true
  if (profile?.role === 'admin') return true
  if (needs === 'cmf') return profile?.cmfAccess === true
  if (needs === 'packaging') return profile?.packagingAccess === true
  return false
}

/**
 * The tools a credential may list and call on this request.
 *
 * - An explicit list (every static token) is honoured as stored, restricted
 *   to tools this server knows, in registry order.
 * - `'*'` expands to every OAuth tool whose flag the owner holds.
 */
export function effectiveTools(
  credential: { allowedTools: readonly string[] },
  profile?: ToolPolicyProfile | null
): HeadlessTool[] {
  if (credential.allowedTools.includes('*')) {
    return HEADLESS_TOOLS.filter(
      (tool) => TOOL_META[tool].oauth && ownerHasFlag(TOOL_META[tool].needs, profile)
    )
  }
  return HEADLESS_TOOLS.filter((tool) => credential.allowedTools.includes(tool))
}

/**
 * Whether a caller can collect a job it was handed. A long call only hands
 * back a job id when this is true; otherwise it runs to the end in the
 * request, exactly as before jobs existed.
 */
export function canPollJobs(tools: readonly string[]): boolean {
  return tools.includes('get_generation_status')
}
