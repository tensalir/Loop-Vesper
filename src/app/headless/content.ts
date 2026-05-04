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
    { id: 'engine', label: 'What is inside', href: '#engine' },
    { id: 'surfaces', label: 'How to use it', href: '#surfaces' },
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
    { k: 'Recommended way in', v: 'Cursor connector (works today)' },
    { k: 'Also live', v: 'API for systems · Web app for Studio' },
    { k: 'Status', v: 'Private preview, by invite' },
  ] as { k: string; v: string }[],
}

/* ─────────────────────────────────────────────────────────────────────────
 * Why headless — the shift this page is responding to.
 * ─────────────────────────────────────────────────────────────────────── */

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

/** A copy-pasteable field rendered as a labelled value with a Copy button. */
export type SurfaceField = {
  label: string
  value: string
  /** Optional one-liner shown below the field. Plain language only. */
  hint?: string
}

/** A single install step. `main` is the headline, `detail` adds context. */
export type SurfaceInstruction = {
  main: string
  detail?: string
}

/**
 * A primary action on a surface card. Today this is used to offer the
 * `.skill` bundle as a download from the Skill bundle surface.
 */
export type SurfaceAction = {
  label: string
  href: string
  /** When set, the link is rendered with a `download` attribute and this
   *  value is used as the suggested filename. */
  filename?: string
  /** Small text rendered under the action button. Plain language. */
  hint?: string
}

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
  detail: {
    title: string
    meta: string
    /** Optional intro paragraph shown above the fields. */
    body?: string
    /** Copy-pasteable values. Render as a list of label + value + Copy button. */
    fields?: SurfaceField[]
    /** Optional install steps shown under the fields. */
    instructions?: SurfaceInstruction[]
    /** Optional primary action (e.g. download a bundle). */
    action?: SurfaceAction
    /** Optional small footnote at the bottom of the panel (e.g. known gaps). */
    footnote?: string
  }
}

export const surfacesSection = {
  eyebrow: 'How to use it',
  title: 'One Vesper.',
  titleEm: 'A few different ways to reach it.',
  lede:
    'The recommended way in is the MCP connector. You add Vesper to your AI client once, with two values Loop sends you, and Vesper shows up as a built-in tool. No code to write, no keys to manage. The other surfaces are for developers and for the Studio team itself.',
  panelLabel: 'Vesper engine · v1',
}

export const surfaces: Surface[] = [
  {
    id: 'mcp',
    icon: '◇',
    name: 'Add to Claude',
    verb: 'One URL to paste. Five-minute install.',
    who: 'The recommended way for everyone. Loop emails you a unique URL. You paste it once into Claude. Vesper shows up as a built-in tool the assistant can call directly.',
    status: 'recommended',
    badge: 'Recommended',
    detail: {
      title: 'Add Vesper to Claude',
      meta: 'One URL to paste',
      body:
        'Vesper plugs into Claude as a custom connector. Loop sends you a unique URL when you join the preview. There is nothing else to install and no separate login to remember.',
      fields: [
        {
          label: 'Server URL',
          value: 'https://vesper.loop.dev/api/mcp/<your-token>',
          hint: 'Loop emails you the unique URL when you join the preview. Treat it like a password — anyone with the URL can call Vesper as you.',
        },
      ],
      instructions: [
        {
          main: 'Open Claude and go to Customize, then Connectors.',
          detail:
            'In claude.ai, the desktop app, or Cowork, find the Customize sidebar. The Connectors panel is there.',
        },
        {
          main: 'Click the + button at the top right, then Add custom connector.',
        },
        {
          main: 'Paste the URL Loop sent you into the Remote MCP server URL field. Leave Advanced settings empty.',
        },
        {
          main: 'Click Add. Vesper now appears in the Connectors list with three tools: make a prompt better, see alternatives, find the right model.',
        },
      ],
      footnote:
        'Building inside Cursor or directly against the Anthropic API instead? The same engine is available via a bearer-token URL — see `docs/headless-vesper.md` in the Loop-Vesper repo for the developer setup.',
    },
  },
  {
    id: 'rest',
    icon: '{ }',
    name: 'API for your systems',
    verb: 'For developers wiring Vesper into their own tools.',
    who: 'For backend integrations only. Pick this if you are building a server, not a chat or agent.',
    status: 'live',
    badge: 'API',
    detail: {
      title: 'API for your systems',
      meta: 'For developers',
      body:
        'A standard REST surface. Same access token as the MCP connector. Use it when you need Vesper inside your own backend, batch script, or admin tool.',
      fields: [
        {
          label: 'Endpoint',
          value: 'POST https://vesper.loop.dev/api/headless/v1/prompts/enhance',
        },
        {
          label: 'Authorization header',
          value: 'Bearer vsp_live_<your-token>',
          hint: 'Server-to-server only. Never paste this into a browser or end-user app.',
        },
      ],
      instructions: [
        {
          main: 'Send a JSON body with your prompt and a model id.',
          detail:
            'Example body: { "prompt": "documentary still of a potter", "modelId": "gemini-nano-banana-pro" }',
        },
        {
          main: 'Read the response. Vesper returns the sharpened prompt and the skill version it used.',
        },
        {
          main: 'Watch the rate-limit headers. The remaining minute and day budget is on every response.',
        },
      ],
      footnote:
        'Full request shapes, error codes, and the rate-limit reference live in `docs/headless-vesper.md` inside the Loop-Vesper repo.',
    },
  },
  {
    id: 'web',
    icon: '◐',
    name: 'The Vesper web app',
    verb: 'For the Loop Studio team.',
    who: 'What the Studio team uses every day. The full canvas for image and video work, with the same Loop know-how built in.',
    status: 'live',
    detail: {
      title: 'The Vesper web app',
      meta: 'For the Studio team',
      body:
        'The original Vesper. A full canvas for image and video work: prompt, reference images, branching, animate-still, gallery review. Sign in with your Loop account and pick up where the Studio team left off.',
    },
  },
  {
    id: 'skill',
    icon: '✦',
    name: 'Skill bundle',
    verb: 'For Claude.ai and ChatGPT.',
    who: 'The same Loop know-how, packaged so it drops directly into Claude.ai, ChatGPT, or any agent shell that understands the Anthropic Skills format.',
    status: 'live',
    badge: 'Download',
    detail: {
      title: 'Skill bundle',
      meta: 'genai-prompting · v2026-05',
      body:
        'The Loop gen-ai prompting know-how, packaged as a single .skill file. Inside Claude.ai it drops into Customize. In ChatGPT or any agent shell that supports Skills, it sits next to your other capabilities. Same source as the connector above.',
      action: {
        label: 'Download genai-prompting.skill',
        href: '/skills/genai-prompting.skill',
        filename: 'genai-prompting.skill',
        hint: 'About 20 KB. Open Claude.ai, then drop it into Customize -> Skills.',
      },
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
