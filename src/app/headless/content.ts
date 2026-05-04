/**
 * Static content for the `/headless` landing page.
 *
 * Kept in a single file so a non-engineer can edit copy without
 * touching JSX. Each block maps 1:1 to a section in `page.tsx`.
 */

export type NavLink = { id: string; label: string; href: string }

export const nav = {
  brand: 'Vesper',
  brandSub: 'For Loop partners',
  status: 'By Loop · Studio',
  links: [
    { id: 'why', label: 'Why this matters', href: '#why' },
    { id: 'engine', label: 'What is inside', href: '#engine' },
    { id: 'surfaces', label: 'Where you use it', href: '#surfaces' },
    { id: 'use', label: 'Setup', href: '#use' },
  ] as NavLink[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Hero — name the layer.
 * ─────────────────────────────────────────────────────────────────────── */

export const hero = {
  eyebrow: 'Vesper Headless',
  titlePre: 'The same Vesper your team trusts,',
  titleEm: 'now reachable from every tool around it.',
  lede:
    'Vesper is the image and video workshop the Loop Studio team uses every day. It already knows what good Loop work looks like: the brand voice, the product line, the rules a designer would apply on a first pass. Vesper Headless lets you tap into that same know-how from inside Claude, Cursor, or any tool that fits a small connector.',
  meta: [
    { k: 'Recommended way in', v: 'Connector for Claude and Cursor' },
    { k: 'Also live', v: 'API for systems · Web app for Studio' },
    { k: 'Status', v: 'Private preview, by invite' },
  ] as { k: string; v: string }[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Why headless — the shift this page is responding to.
 * ─────────────────────────────────────────────────────────────────────── */

export const why = {
  eyebrow: 'Why this matters',
  title: 'Most AI tools are clever.',
  titleEm: 'Few of them know your taste.',
  lede:
    'Models keep changing. New AI tools land every month. The one thing that stays steady is what your team has already learned about Loop: how it talks, what a great ad looks like, what Studio approves on the first pass. Build that into one place, and every new tool you adopt inherits it the day you turn it on.',
  points: [
    {
      id: 'multiplying',
      title: 'New tools every month.',
      body:
        'A copilot here, an agent there, a plugin somewhere else. Each team picks something different. Each new tool starts from zero on what Loop is.',
    },
    {
      id: 'churn',
      title: 'Models keep moving.',
      body:
        'What you wired up for one model often breaks on the next. Models come and go. What your team knows stays, and Vesper carries it across.',
    },
    {
      id: 'context',
      title: 'Loop know-how is the difference.',
      body:
        'Product names, brand voice, what Studio approves on the first pass. That is the part no off-the-shelf AI can guess. Captured once inside Vesper, every tool that talks to it inherits the same taste.',
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
  eyebrow: 'What is inside',
  title: 'One engine.',
  titleEm: 'Same Loop know-how, three jobs it can do for you.',
  lede:
    'Open the Vesper web app, ask Vesper from inside Claude, or call it from your own scripts. You are always talking to the same engine, with the same brand context and the same model rules. The web app proves it works. Headless lets you reach it from anywhere else.',
  panelTitle: 'Vesper engine',
  panelBadge: 'Headless',
  inputsHeading: 'What it knows',
  outputsHeading: 'What you can ask it to do',
  layers: [
    {
      id: 'skill',
      tag: 'Know-how',
      name: 'how Loop writes a great prompt',
      meta: 'one source, versioned',
    },
    {
      id: 'models',
      tag: 'Models',
      name: 'image and video models',
      meta: 'scoped per partner',
    },
    {
      id: 'auth',
      tag: 'Sign-in',
      name: 'one Loop login per partner',
      meta: 'revocable any time',
    },
    {
      id: 'limits',
      tag: 'Limits',
      name: 'sane minute and day caps',
      meta: 'shown on every response',
    },
  ] as EngineLayer[],
  capabilities: [
    {
      id: 'enhance',
      title: 'Make a prompt better.',
      body:
        'Hand Vesper a rough idea. Get back a sharper, brand-fluent prompt, ready for whichever image or video model you picked.',
    },
    {
      id: 'iterate',
      title: 'See alternatives.',
      body:
        'Ask Vesper for variations on a brief. Get back a small set of distinctly different angles, each one still grounded in what works for Loop.',
    },
    {
      id: 'list',
      title: 'Find the right model.',
      body:
        'Ask which image or video models your access allows. Vesper returns the list with what each one is good at.',
    },
  ] as EngineCapability[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Surfaces — interactive selector.
 *
 * MCP is the primary surface. Most partners will only ever need this one:
 * they install Vesper as a custom connector inside Claude (or Cursor) and
 * the tools appear natively. The other three surfaces are kept as
 * placeholders so callers know the engine is the same underneath, but
 * they are intentionally demoted in the visual hierarchy.
 * ─────────────────────────────────────────────────────────────────────── */

export type SurfaceId = 'mcp' | 'rest' | 'web' | 'skill'

export type SurfaceStatus = 'recommended' | 'live' | 'placeholder'

export type Surface = {
  id: SurfaceId
  icon: string
  name: string
  verb: string
  who: string
  status: SurfaceStatus
  /** Optional short label rendered next to the title in the detail panel
   *  (e.g. "Recommended", "API", "Coming soon"). */
  badge?: string
  detail: { title: string; meta: string; lines: string[] }
}

export const surfacesSection = {
  eyebrow: 'Where you use it',
  title: 'One Vesper.',
  titleEm: 'A few different ways to reach it.',
  lede:
    'For most partners, the recommended way in is the connector. You install Vesper inside Claude or Cursor, sign in once with your Loop account, and Vesper shows up as a built-in tool. No keys to copy, no code to glue together.',
  panelLabel: 'Vesper engine · v1',
}

export const surfaces: Surface[] = [
  {
    id: 'mcp',
    icon: '◇',
    name: 'Claude / Cursor connector',
    verb: 'Install once. Use natively.',
    who: 'The recommended way to use Vesper. Loop sends you the connector details when you are added to the preview. Cursor users can already authenticate today; the Claude sign-in handshake is being prepared.',
    status: 'recommended',
    badge: 'Recommended',
    detail: {
      title: 'Claude / Cursor connector',
      meta: 'Customize -> Connectors -> + -> Add custom connector',
      lines: [
        '// Inside Claude, paste these into the "Add custom connector" form.',
        '',
        'Name                  Vesper',
        'Remote MCP server URL https://vesper.loop.dev/api/mcp',
        '',
        '// Open Advanced settings. Loop sends you these when you are invited:',
        'OAuth Client ID       <provided by Loop>',
        'OAuth Client Secret   <provided by Loop>',
        '',
        '// After you save, Claude opens a Loop sign-in window.',
        '// Vesper then appears alongside Claude\u2019s built-in tools:',
        '//   • Make a prompt better',
        '//   • See alternatives',
        '//   • Find the right model',
        '',
        '// Cursor: same URL, paste under Settings -> MCP.',
      ],
    },
  },
  {
    id: 'rest',
    icon: '{ }',
    name: 'API for your systems',
    verb: 'For developers wiring Vesper into their own tools.',
    who: 'Used by Loop\u2019s own internal tools. Pick this if you are building a backend that needs Vesper, not a chat or agent surface.',
    status: 'live',
    badge: 'API',
    detail: {
      title: 'API for your systems',
      meta: 'POST /api/headless/v1/prompts/enhance',
      lines: [
        '// Server-to-server only. Tokens come from a Loop admin.',
        '// Not for browsers, end-user apps, or anything pasted into a UI.',
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
    id: 'web',
    icon: '◐',
    name: 'The Vesper web app',
    verb: 'For the Loop Studio team.',
    who: 'What the Studio team uses every day. A full canvas for image and video work, with the same Loop know-how underneath.',
    status: 'live',
    detail: {
      title: 'The Vesper web app',
      meta: 'Live · in-app workspace',
      lines: [
        '// The original Vesper. Where the Loop know-how was first built up.',
        '',
        'designer  -> writes a prompt, drops in reference images',
        'vesper    -> sharpens it, generates, branches, animates',
        'review    -> approved straight from the gallery',
      ],
    },
  },
  {
    id: 'skill',
    icon: '✦',
    name: 'Skill bundle',
    verb: 'For Claude.ai and ChatGPT.',
    who: 'The same know-how, packaged so it drops directly into Claude.ai or ChatGPT. Distribution is being prepared.',
    status: 'placeholder',
    badge: 'Coming soon',
    detail: {
      title: 'Skill bundle',
      meta: 'Loop know-how, portable',
      lines: [
        '// The same know-how that powers the connector, packaged so',
        '// you can upload it directly into Claude.ai or ChatGPT.',
        '',
        'name        Loop gen-ai prompting',
        'version     pinned to a specific release',
        'updated     2026-05-04',
        '',
        '// Reach out to the Studio team if you would like access',
        '// while the bundle is in private preview.',
      ],
    },
  },
]

export const surfacesFoot = [
  {
    id: 'compounds',
    title: 'Knowledge builds up.',
    body:
      'Every new rule or example a designer adds inside Vesper shows up everywhere on the next call. The know-how grows over time instead of starting from zero in each new tool.',
  },
  {
    id: 'inherits',
    title: 'Everything stays in sync.',
    body:
      'Web app, connector, your own scripts. They all agree on what good looks like because they all read from the same place underneath.',
  },
  {
    id: 'portable',
    title: 'Outlives the model underneath.',
    body:
      'When the next great image or video model lands, Vesper switches to it. The Loop know-how does not have to be rewritten for the new model.',
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
  eyebrow: 'Setup',
  title: 'Add Vesper to Claude.',
  titleEm: 'Five minutes, no code.',
  lede:
    'Once Loop adds you to the preview, here is exactly what to do inside Claude. The same shape works inside Cursor, under Settings -> MCP.',
  steps: [
    {
      n: '01',
      title: 'Open Claude and find Customize.',
      body:
        'In any Claude surface, whether the web app, the desktop app, or Claude Code, open the Customize sidebar. The Connectors panel lives there.',
      detail: 'Settings -> Customize -> Connectors',
    },
    {
      n: '02',
      title: 'Add a custom connector.',
      body:
        'Click the + button at the top right of the Connectors panel. Choose "Add custom connector" from the dropdown.',
      detail: '+ -> Add custom connector',
    },
    {
      n: '03',
      title: 'Paste the Vesper details.',
      body:
        'Name the connector "Vesper" and paste the address Loop sends you. Open Advanced settings and paste the two access codes Loop will provide.',
      detail: 'Name: Vesper · URL: https://vesper.loop.dev/api/mcp',
    },
    {
      n: '04',
      title: 'Sign in once. Vesper is ready.',
      body:
        'Claude opens a Loop sign-in window. Approve the connection. Vesper now appears alongside Claude\u2019s built-in tools, ready to call.',
      detail: 'Loop sign-in · approve · tools auto-discovered',
    },
  ] as UseStep[],
  footnote:
    'Heads up: the Loop sign-in handshake (the standard "OAuth" flow) is being prepared right now. Loop will hand you the access codes when you are added to the preview. Cursor users and direct script integrations can already authenticate today using a token; the full technical reference lives in `docs/headless-vesper.md` inside the Loop-Vesper repo.',
}

/* ─────────────────────────────────────────────────────────────────────────
 * Close — final framing + contact.
 * ─────────────────────────────────────────────────────────────────────── */

export const close = {
  eyebrow: 'Build it once. Use it everywhere.',
  title: 'The web app is the proof.',
  titleEm: 'The Loop know-how is the real thing.',
  lede:
    'Vesper Headless is how Loop turns what the Studio team already knows into something every other tool can tap into. If you build inside Loop and would like access during the preview, the Studio team is the one to reach out to.',
  primary: { label: 'Talk to the Studio team', href: 'mailto:hello@thoughtform.studio?subject=Vesper%20Headless' },
  secondary: { label: 'Read why this matters', href: '#why' },
}

export const footer = {
  line: 'Vesper · Image and video workshop, headless edition',
  signature: 'By Loop Earplugs · Studio',
}
