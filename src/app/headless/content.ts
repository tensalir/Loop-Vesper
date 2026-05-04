/**
 * Static content for the `/headless` landing page.
 *
 * Kept in a single file so a non-engineer can edit copy without
 * touching JSX. Each block maps 1:1 to a section in `page.tsx`.
 */

export type NavLink = { id: string; label: string; href: string }

export const nav = {
  brand: 'Vesper',
  brandSub: 'Headless creative engine',
  status: 'By Loop · Studio',
  links: [
    { id: 'why', label: 'Why headless', href: '#why' },
    { id: 'engine', label: 'The engine', href: '#engine' },
    { id: 'surfaces', label: 'Surfaces', href: '#surfaces' },
    { id: 'use', label: 'Use it', href: '#use' },
  ] as NavLink[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Hero — name the layer.
 * ─────────────────────────────────────────────────────────────────────── */

export const hero = {
  eyebrow: 'Vesper Headless',
  titlePre: 'The creative engine behind the workspace,',
  titleEm: 'now callable from anywhere.',
  lede:
    'Vesper started as a generation workspace for the Loop Studio team. Underneath, the same engine encodes prompt judgment, model strategy, and Loop product context. Headless makes that engine reachable from any tool, agent, or surface — without rebuilding it for each one.',
  meta: [
    { k: 'Surfaces today', v: 'Web · REST · MCP · Skill' },
    { k: 'Auth', v: 'Per-credential bearer tokens' },
    { k: 'Status', v: 'Live · v1' },
  ] as { k: string; v: string }[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Why headless — the shift this page is responding to.
 * ─────────────────────────────────────────────────────────────────────── */

export const why = {
  eyebrow: 'Why headless',
  title: 'The interface used to be the product.',
  titleEm: 'Now the substrate is.',
  lede:
    'Models change every quarter. Surfaces multiply. The durable asset is the encoded judgment underneath: the prompt strategies, the model rules, the product context. Build that once, expose it cleanly, and the next surface inherits it for free.',
  points: [
    {
      id: 'multiplying',
      title: 'Surfaces are multiplying.',
      body:
        'Chat, copilot, agent, plugin, automation. Every team wants to call the same intelligence from a different place.',
    },
    {
      id: 'churn',
      title: 'Models churn faster than tools.',
      body:
        'Whatever you wired into Vesper for today’s model is wired into Vesper for tomorrow’s. The substrate carries forward.',
    },
    {
      id: 'context',
      title: 'Loop context is the moat.',
      body:
        'Product catalogue, brand voice, and review judgment are encoded once and inherited everywhere a credential reaches.',
    },
  ],
}

/* ─────────────────────────────────────────────────────────────────────────
 * The engine — what Vesper actually exposes.
 * ─────────────────────────────────────────────────────────────────────── */

export type EngineLayer = {
  id: 'skill' | 'models' | 'auth' | 'limits'
  tag: string
  name: string
  meta: string
}

export type EngineCapability = {
  id: string
  title: string
  body: string
}

export const engine = {
  eyebrow: 'The engine',
  title: 'One callable surface.',
  titleEm: 'Three production-grade capabilities.',
  lede:
    'Every Vesper surface — the web app you already know, the REST API, the MCP tools — runs on the same engine. Encode once underneath, run through whichever surface fits the work.',
  panelTitle: 'Vesper engine',
  panelBadge: 'Headless',
  inputsHeading: 'Substrate',
  outputsHeading: 'Capabilities',
  layers: [
    {
      id: 'skill',
      tag: 'Skill',
      name: 'gen-ai prompting',
      meta: 'versioned, hash-pinned',
    },
    {
      id: 'models',
      tag: 'Models',
      name: 'image + video registry',
      meta: 'per-credential allowlist',
    },
    {
      id: 'auth',
      tag: 'Auth',
      name: 'bearer credentials',
      meta: 'hashed, revocable',
    },
    {
      id: 'limits',
      tag: 'Limits',
      name: 'minute + day buckets',
      meta: 'durable, audited',
    },
  ] as EngineLayer[],
  capabilities: [
    {
      id: 'enhance',
      title: 'Enhance a prompt.',
      body:
        'Run a single image or video prompt through Vesper’s gen-ai prompting skill. Reference images and target model are honoured.',
    },
    {
      id: 'iterate',
      title: 'Diversify a slate.',
      body:
        'Given a baseline concept, return an Andromeda-aware variant slate across concept, persona, and visual treatment axes.',
    },
    {
      id: 'list',
      title: 'List the models.',
      body:
        'Discover the image and video models the calling credential is permitted to use, with per-model metadata.',
    },
  ] as EngineCapability[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Surfaces — interactive selector.
 * ─────────────────────────────────────────────────────────────────────── */

export type SurfaceId = 'web' | 'rest' | 'mcp' | 'skill'

export type Surface = {
  id: SurfaceId
  icon: string
  name: string
  verb: string
  who: string
  detail: { title: string; meta: string; lines: string[] }
}

export const surfacesSection = {
  eyebrow: 'Surfaces',
  title: 'One engine.',
  titleEm: 'Pick the surface that fits the work.',
  lede:
    'Same prompt enhancement. Same iteration logic. Same model rules. Different way in. Pick a surface to see the shape of the call.',
  panelLabel: 'Vesper engine · v1',
}

export const surfaces: Surface[] = [
  {
    id: 'web',
    icon: '◐',
    name: 'Web app',
    verb: 'For the Studio team',
    who: 'Used daily in the Loop Studio',
    detail: {
      title: 'Web app',
      meta: 'Live · in-app workspace',
      lines: [
        '// the original surface — proof the engine works inside the work',
        '',
        'designer  -> prompt + reference image',
        'vesper    -> enhance, generate, branch, animate-still',
        'review    -> approved straight from the gallery',
      ],
    },
  },
  {
    id: 'rest',
    icon: '{ }',
    name: 'REST API',
    verb: 'For your systems',
    who: 'Called from Loop tools and integrations',
    detail: {
      title: 'REST API',
      meta: 'POST /api/headless/v1/prompts/enhance',
      lines: [
        '// authenticate per credential, scoped tools + models',
        '',
        'POST /api/headless/v1/prompts/enhance',
        'Authorization: Bearer vsp_live_…',
        'Content-Type: application/json',
        '',
        '{ "prompt": "documentary still of a potter at a wheel",',
        '  "modelId": "gemini-nano-banana-pro" }',
        '',
        '-> { enhancedPrompt, modelId, skill: { hash, lastModified } }',
      ],
    },
  },
  {
    id: 'mcp',
    icon: '◇',
    name: 'MCP server',
    verb: 'For agents',
    who: 'Cursor, Claude, any MCP-aware runtime',
    detail: {
      title: 'MCP server',
      meta: 'POST /api/mcp · JSON-RPC 2.0',
      lines: [
        '// register Vesper as a remote MCP server',
        '',
        '{ "vesper": {',
        '    "url": "https://<vesper-host>/api/mcp",',
        '    "headers": {',
        '      "Authorization": "Bearer vsp_live_…"',
        '    }',
        '} }',
        '',
        '-> tools: enhance_prompt, iterate_prompt, list_models',
      ],
    },
  },
  {
    id: 'skill',
    icon: '✦',
    name: 'Skill bundle',
    verb: 'For Claude + ChatGPT',
    who: 'The same prompting skill, runnable inside any agent shell',
    detail: {
      title: 'Skill bundle',
      meta: 'gen-ai prompting · portable',
      lines: [
        '// the skill behind the engine, packaged for agent runtimes',
        '',
        'skill_id   = "genai-prompting"',
        'hash       = "a1b2c3d4e5f6"',
        'updated_at = "2026-05-04T11:48:00Z"',
        '',
        '-> same judgment in Claude.ai, ChatGPT, or any MCP host',
      ],
    },
  },
]

export const surfacesFoot = [
  {
    id: 'compounds',
    title: 'Substrate compounds.',
    body:
      'Every prompt rule, model strategy, and Loop product update lands in one place and is inherited by every surface on the next call.',
  },
  {
    id: 'inherits',
    title: 'Surfaces inherit, not duplicate.',
    body:
      'A new agent surface or internal tool reuses the same engine. No second prompt library. No drift between web and API.',
  },
  {
    id: 'portable',
    title: 'Models change. Skill carries forward.',
    body:
      'Model providers shift. The encoded skill outlives them. Switch the underlying model without rewriting the surface.',
  },
]

/* ─────────────────────────────────────────────────────────────────────────
 * Use it — concrete adoption steps.
 * ─────────────────────────────────────────────────────────────────────── */

export type UseStep = {
  n: string
  title: string
  body: string
  detail?: string
}

export const useSection = {
  eyebrow: 'Use it',
  title: 'Get a credential.',
  titleEm: 'Call the engine. Inherit the substrate.',
  lede:
    'Headless Vesper is invitation-only today. Once a credential is issued, every surface is reachable with a single bearer token.',
  steps: [
    {
      n: '01',
      title: 'Issue a credential.',
      body:
        'A Loop admin creates a credential scoped to specific tools, models, and per-minute / per-day rate limits. The plaintext token is shown once.',
      detail: 'POST /api/admin/headless-credentials',
    },
    {
      n: '02',
      title: 'Send the bearer.',
      body:
        'Every authenticated request carries `Authorization: Bearer vsp_live_…`. Tokens are hashed at rest and instantly revocable.',
      detail: 'Authorization: Bearer vsp_live_…',
    },
    {
      n: '03',
      title: 'Read the rate-limit headers.',
      body:
        'Each response carries the remaining minute and day budget so callers can back off cleanly. 429s include `Retry-After`.',
      detail: 'X-RateLimit-Remaining-Minute, X-RateLimit-Remaining-Day',
    },
    {
      n: '04',
      title: 'Pick a surface and ship.',
      body:
        'Same engine, four ways in. Use the REST endpoint from your stack, the MCP tools from your agent, the skill bundle from any agent shell.',
      detail: 'GET /api/headless/v1 — discovery, no auth required',
    },
  ] as UseStep[],
  footnote:
    'Full reference, request shapes, and example responses live in `docs/headless-vesper.md` inside the Loop-Vesper repo.',
}

/* ─────────────────────────────────────────────────────────────────────────
 * Close — final framing + contact.
 * ─────────────────────────────────────────────────────────────────────── */

export const close = {
  eyebrow: 'Encode once · Run everywhere',
  title: 'The interface is the proof.',
  titleEm: 'The substrate is the asset.',
  lede:
    'Vesper Headless is how Loop turns the team’s creative judgment into infrastructure other surfaces can inherit. If you are building inside Loop and want a credential, reach out to the Studio team.',
  primary: { label: 'Talk to the Studio team', href: 'mailto:hello@thoughtform.studio?subject=Vesper%20Headless' },
  secondary: { label: 'Read the field notes', href: '#why' },
}

export const footer = {
  line: 'Vesper · Headless creative engine',
  signature: 'By Loop Earplugs · Studio',
}
