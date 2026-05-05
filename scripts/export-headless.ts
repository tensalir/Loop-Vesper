/**
 * Export a self-contained HTML snapshot of the /headless landing page.
 *
 * Reads the same `content.ts` the live page uses, inlines `headless.css`
 * and the brand SVG, and writes a single file you can email, attach to
 * a deck, or open with `file://`.
 *
 * Run with:
 *   npm run export:headless
 *
 * Output: out/headless-export.html (out/ is gitignored).
 *
 * The MCP card renders its read-only "no-token" state — the Generate URL
 * flow needs the live API + Supabase auth, so the export shows the
 * placeholder URL with a clear note pointing readers at the live page.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  close,
  engine,
  footer,
  hero,
  nav,
  surfaces,
  surfacesFoot,
  surfacesSection,
  type Surface,
  type SurfaceField,
  type SurfaceInstruction,
} from '../src/app/headless/content'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'out')
const OUT_FILE = path.join(OUT_DIR, 'headless-export.html')

/**
 * Live URL the export points readers to. The static export cannot run
 * the Generate URL flow itself, so it links back here.
 */
const LIVE_URL = 'https://loopvesper-one.vercel.app/headless'

/* ──────────────────────────────────────────────────────────────────────
 * Tiny HTML escape. Used everywhere user-editable content lands in the
 * static template so a stray quote in `content.ts` cannot break the
 * output (e.g. attribute boundaries).
 * ─────────────────────────────────────────────────────────────────── */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function attr(value: string): string {
  return esc(value)
}

/* ──────────────────────────────────────────────────────────────────────
 * Per-section renderers. Mirror the JSX in page.tsx + SurfacesSelector
 * but emit plain HTML strings so the output has no React, no hydration,
 * and nothing to bundle.
 * ─────────────────────────────────────────────────────────────────── */

function renderHero(): string {
  const meta = hero.meta
    .map(
      (cell) => `
        <div class="vh-hero__meta-cell">
          <dt>${esc(cell.k)}</dt>
          <dd>${esc(cell.v)}</dd>
        </div>`,
    )
    .join('')

  return `
    <section class="vh-hero">
      <div class="vh-wrap vh-hero__grid">
        <div class="vh-hero__text">
          <p class="vh-eyebrow">
            <span class="vh-eyebrow__pulse" aria-hidden="true"></span>
            <span>${esc(hero.eyebrow)}</span>
          </p>
          <h1 class="vh-hero__title">
            ${esc(hero.titlePre)} <em>${esc(hero.titleEm)}</em>
          </h1>
          <p class="vh-hero__lede">${esc(hero.lede)}</p>
          <dl class="vh-hero__meta">${meta}</dl>
        </div>

        <aside class="vh-hero__panel" aria-label="Where Vesper shows up">
          <span class="vh-hero__panel-halo" aria-hidden="true"></span>
          <header class="vh-hero__panel-head">
            <span class="vh-hero__panel-dot" aria-hidden="true"></span>
            <span class="vh-hero__panel-label">One Vesper · four ways in</span>
            <span class="vh-hero__panel-live">Live</span>
          </header>
          <div class="vh-orbit" aria-hidden="true">
            <span class="vh-orbit__ring vh-orbit__ring--outer"></span>
            <span class="vh-orbit__ring vh-orbit__ring--inner"></span>
            <span class="vh-orbit__pill vh-orbit__pill--top vh-orbit__pill--primary">
              <span class="vh-orbit__pill-dot"></span><span>Connector</span>
            </span>
            <span class="vh-orbit__pill vh-orbit__pill--right">
              <span class="vh-orbit__pill-dot"></span><span>REST API</span>
            </span>
            <span class="vh-orbit__pill vh-orbit__pill--bottom-left">
              <span class="vh-orbit__pill-dot"></span><span>Web app</span>
            </span>
            <span class="vh-orbit__pill vh-orbit__pill--bottom-right">
              <span class="vh-orbit__pill-dot"></span><span>Skill</span>
            </span>
            <span class="vh-orbit__core">
              <strong>Vesper</strong>
              <span>Loop know-how</span>
            </span>
          </div>
        </aside>
      </div>
    </section>`
}

function renderEngine(): string {
  const layers = engine.layers
    .map(
      (layer) => `
      <li class="vh-engine__layer">
        <span class="vh-engine__layer-tag">${esc(layer.tag)}</span>
        <span class="vh-engine__layer-name">${esc(layer.name)}</span>
        <span class="vh-engine__layer-meta">${esc(layer.meta)}</span>
      </li>`,
    )
    .join('')

  const capabilities = engine.capabilities
    .map(
      (cap) => `
      <li class="vh-engine__capability">
        <h3 class="vh-engine__capability-title">${esc(cap.title)}</h3>
        <p class="vh-engine__capability-body">${esc(cap.body)}</p>
      </li>`,
    )
    .join('')

  return `
    <section class="vh-section" id="engine">
      <div class="vh-wrap">
        <header class="vh-section-head">
          <p class="vh-section-eyebrow">${esc(engine.eyebrow)}</p>
          <h2 class="vh-section-title">
            ${esc(engine.title)} <em>${esc(engine.titleEm)}</em>
          </h2>
          <p class="vh-section-intro">${esc(engine.lede)}</p>
        </header>

        <div class="vh-engine">
          <header class="vh-engine__head">
            <strong>${esc(engine.panelTitle)}</strong>
            <span class="vh-engine__badge">${esc(engine.panelBadge)}</span>
          </header>
          <div class="vh-engine__grid">
            <div class="vh-engine__col">
              <p class="vh-engine__col-h">${esc(engine.inputsHeading)}</p>
              <ul class="vh-engine__layers">${layers}</ul>
            </div>
            <div class="vh-engine__arrow" aria-hidden="true">
              <span class="vh-engine__arrow-line"></span>
            </div>
            <div class="vh-engine__col">
              <p class="vh-engine__col-h">${esc(engine.outputsHeading)}</p>
              <ul class="vh-engine__capabilities">${capabilities}</ul>
            </div>
          </div>
        </div>
      </div>
    </section>`
}

function renderField(field: SurfaceField, idx: number, surfaceId: string): string {
  const valueId = `vh-value-${surfaceId}-${idx}`
  return `
    <li class="vh-field">
      <label class="vh-field__label" for="${attr(valueId)}">${esc(field.label)}</label>
      <div class="vh-field__row">
        <code class="vh-field__value" id="${attr(valueId)}">${esc(field.value)}</code>
        <button
          type="button"
          class="vh-copy"
          data-copy-target="${attr(valueId)}"
          aria-label="Copy ${attr(field.label)}"
        >
          <span aria-hidden="true" class="vh-copy__icon">⧉</span>
          <span class="vh-copy__label">Copy</span>
        </button>
      </div>
      ${field.hint ? `<p class="vh-field__hint">${esc(field.hint)}</p>` : ''}
    </li>`
}

function renderInstruction(step: SurfaceInstruction, idx: number): string {
  return `
    <li class="vh-how__step">
      <span class="vh-how__num" aria-hidden="true">${String(idx + 1).padStart(2, '0')}</span>
      <div class="vh-how__copy">
        <p class="vh-how__main">${esc(step.main)}</p>
        ${step.detail ? `<p class="vh-how__detail">${esc(step.detail)}</p>` : ''}
      </div>
    </li>`
}

function renderMcpStaticBlock(): string {
  return `
    <div class="vh-mcp">
      <label class="vh-field__label">Server URL</label>
      <div class="vh-field__row">
        <code class="vh-field__value vh-field__value--placeholder">https://vesper.loop.dev/api/mcp/&lt;your-token&gt;</code>
        <button type="button" class="vh-copy" disabled aria-label="Generate URL on the live page">
          <span aria-hidden="true" class="vh-copy__icon">→</span>
          <span class="vh-copy__label">Generate on live</span>
        </button>
      </div>
      <p class="vh-field__hint">
        This is a static snapshot. Generating your real URL needs the live page:
        <a href="${attr(LIVE_URL)}" class="vh-mcp__linkbtn" rel="noopener">${esc(LIVE_URL)}</a>.
      </p>
    </div>`
}

function renderSurfaceCard(surface: Surface): string {
  const classes = ['vh-surfaces__option', `vh-surfaces__option--${surface.status}`]
  const badge = surface.badge
    ? `<span class="vh-surfaces__badge vh-surfaces__badge--${surface.status}">${esc(surface.badge)}</span>`
    : ''
  return `
    <li>
      <button
        type="button"
        role="tab"
        data-surface-tab="${attr(surface.id)}"
        aria-controls="vh-surface-panel-${attr(surface.id)}"
        id="vh-surface-tab-${attr(surface.id)}"
        class="${classes.join(' ')}"
      >
        <span class="vh-surfaces__icon" aria-hidden="true">${esc(surface.icon)}</span>
        <span class="vh-surfaces__copy">
          <span class="vh-surfaces__name-row">
            <span class="vh-surfaces__name">${esc(surface.name)}</span>
            ${badge}
          </span>
          <span class="vh-surfaces__verb">${esc(surface.verb)}</span>
        </span>
        <span class="vh-surfaces__caret" aria-hidden="true">→</span>
      </button>
    </li>`
}

function renderSurfacePanel(surface: Surface): string {
  const fields = surface.detail.fields
    ? `<ul class="vh-fields" role="list">${surface.detail.fields
        .map((f, i) => renderField(f, i, surface.id))
        .join('')}</ul>`
    : ''

  const instructions = surface.detail.instructions
    ? `
      <div class="vh-how">
        <p class="vh-how__h">How to install</p>
        <ol class="vh-how__steps">${surface.detail.instructions
          .map((step, i) => renderInstruction(step, i))
          .join('')}</ol>
      </div>`
    : ''

  const action = surface.detail.action
    ? `
      <div class="vh-action">
        <a class="vh-action__btn" href="${attr(surface.detail.action.href)}"${
          surface.detail.action.filename
            ? ` download="${attr(surface.detail.action.filename)}"`
            : ''
        }>
          <span aria-hidden="true" class="vh-action__icon">↓</span>
          <span>${esc(surface.detail.action.label)}</span>
        </a>
        ${
          surface.detail.action.hint
            ? `<p class="vh-action__hint">${esc(surface.detail.action.hint)}</p>`
            : ''
        }
      </div>`
    : ''

  const footnote = surface.detail.footnote
    ? `<p class="vh-panel-foot">${esc(surface.detail.footnote)}</p>`
    : ''

  // For MCP, replace the static field renderer with the read-only static
  // block that explains the Generate URL flow lives on the live page.
  const fieldsBlock = surface.id === 'mcp' ? renderMcpStaticBlock() : fields
  const body = surface.detail.body
    ? `<p class="vh-panel-prose">${esc(surface.detail.body)}</p>`
    : ''

  const who = surface.who
    ? `
      <p class="vh-surfaces__panel-who">
        <span class="sr-only">${esc(surfacesSection.panelLabel)} · </span>
        ${esc(surface.who)}
      </p>`
    : ''

  return `
    <div
      class="vh-surfaces__panel vh-surfaces__panel--${surface.status}"
      role="tabpanel"
      id="vh-surface-panel-${attr(surface.id)}"
      aria-labelledby="vh-surface-tab-${attr(surface.id)}"
      data-surface-panel="${attr(surface.id)}"
    >
      <header class="vh-surfaces__panel-head">
        <span class="vh-surfaces__panel-title">${esc(surface.detail.title)}</span>
        <span class="vh-surfaces__panel-meta">${esc(surface.detail.meta)}</span>
      </header>
      <div class="vh-surfaces__panel-body">
        ${body}
        ${fieldsBlock}
        ${instructions}
        ${action}
        ${footnote}
      </div>
      ${who}
    </div>`
}

function renderSurfaces(): string {
  const initialId =
    surfaces.find((s) => s.status === 'recommended')?.id ?? surfaces[0]?.id ?? 'mcp'
  const tabs = surfaces.map(renderSurfaceCard).join('')
  const panels = surfaces.map(renderSurfacePanel).join('')
  const foot = surfacesFoot
    .map(
      (point) => `
      <li class="vh-surfaces__foot-item">
        <h3>${esc(point.title)}</h3>
        <p>${esc(point.body)}</p>
      </li>`,
    )
    .join('')

  return `
    <section class="vh-section vh-section--soft" id="surfaces">
      <div class="vh-wrap">
        <header class="vh-section-head">
          <p class="vh-section-eyebrow">${esc(surfacesSection.eyebrow)}</p>
          <h2 class="vh-section-title">
            ${esc(surfacesSection.title)} <em>${esc(surfacesSection.titleEm)}</em>
          </h2>
          <p class="vh-section-intro">${esc(surfacesSection.lede)}</p>
        </header>

        <div class="vh-surfaces" data-initial-surface="${attr(initialId)}">
          <ul class="vh-surfaces__list" role="tablist" aria-label="Vesper surfaces">${tabs}</ul>
          ${panels}
        </div>

        <ul class="vh-surfaces__foot">${foot}</ul>
      </div>
    </section>`
}

function renderClose(): string {
  return `
    <section class="vh-section" id="cta">
      <div class="vh-wrap vh-close">
        <p class="vh-section-eyebrow">${esc(close.eyebrow)}</p>
        <h2 class="vh-close__title">
          ${esc(close.title)} <em>${esc(close.titleEm)}</em>
        </h2>
        <p class="vh-close__lede">${esc(close.lede)}</p>
        <div class="vh-actions">
          <a class="vh-btn vh-btn--primary" href="${attr(close.primary.href)}">
            ${esc(close.primary.label)} <span aria-hidden="true">→</span>
          </a>
          <a class="vh-btn vh-btn--ghost" href="${attr(close.secondary.href)}">
            ${esc(close.secondary.label)}
          </a>
        </div>
      </div>
    </section>`
}

function renderNav(brandSvgInline: string): string {
  return `
    <header class="vh-nav">
      <div class="vh-wrap vh-nav__inner">
        <a href="${attr(LIVE_URL)}" class="vh-nav__brand">
          <span class="vh-nav__brand-mark" style="display:inline-flex;align-items:center;height:28px;">${brandSvgInline}</span>
          <span class="vh-nav__brand-divider" aria-hidden="true"></span>
          <span class="vh-nav__brand-sub">${esc(nav.brandSub)}</span>
        </a>
        <nav class="vh-nav__links" aria-label="Page sections">
          ${nav.links
            .map((link) => `<a href="${attr(link.href)}">${esc(link.label)}</a>`)
            .join('')}
        </nav>
        <span class="vh-nav__status">${esc(nav.status)}</span>
      </div>
    </header>`
}

function renderFooter(): string {
  return `
    <footer class="vh-footer">
      <div class="vh-wrap vh-footer__inner">
        <span>${esc(footer.line)}</span>
        <span>${esc(footer.signature)}</span>
      </div>
    </footer>`
}

/* ──────────────────────────────────────────────────────────────────────
 * Tokens.
 *
 * The live app's globals.css defines `:root` (light) + `.dark` (dark)
 * Loop tokens; the page is pinned to dark mode via <html class="dark">.
 * For the export we only need the dark mode + a small set of base
 * resets; everything else lives in headless.css which we inline below.
 * ─────────────────────────────────────────────────────────────────── */
const BASE_TOKENS_CSS = `
:root {
  --background: 0 0% 8%;
  --foreground: 0 0% 98%;
  --card: 0 0% 12%;
  --card-foreground: 0 0% 98%;
  --popover: 0 0% 12%;
  --popover-foreground: 0 0% 98%;
  --primary: 131 100% 85%;
  --primary-foreground: 0 0% 10%;
  --secondary: 0 0% 16%;
  --secondary-foreground: 0 0% 98%;
  --muted: 0 0% 18%;
  --muted-foreground: 0 0% 60%;
  --accent: 131 100% 85%;
  --accent-foreground: 0 0% 10%;
  --destructive: 0 72% 55%;
  --destructive-foreground: 0 0% 100%;
  --border: 0 0% 20%;
  --input: 0 0% 20%;
  --ring: 131 100% 85%;
  --radius: 0.75rem;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: 'Space Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-feature-settings: 'ss01', 'cv11', 'kern';
  letter-spacing: -0.005em;
  min-height: 100vh;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`

/* ──────────────────────────────────────────────────────────────────────
 * Tab + copy interactivity, written as a small inline IIFE so the file
 * stays self-contained. No frameworks.
 * ─────────────────────────────────────────────────────────────────── */
const RUNTIME_JS = `
(function () {
  function setActiveSurface(id) {
    document.querySelectorAll('[data-surface-tab]').forEach(function (btn) {
      var on = btn.getAttribute('data-surface-tab') === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-surface-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-surface-panel') !== id;
    });
  }
  document.querySelectorAll('[data-surface-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setActiveSurface(btn.getAttribute('data-surface-tab'));
    });
  });
  var initial = document.querySelector('[data-initial-surface]');
  if (initial) setActiveSurface(initial.getAttribute('data-initial-surface'));

  document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-copy-target'));
      if (!target || !navigator.clipboard) return;
      navigator.clipboard.writeText(target.textContent || '').then(function () {
        var label = btn.querySelector('.vh-copy__label');
        var icon = btn.querySelector('.vh-copy__icon');
        var originalLabel = label ? label.textContent : '';
        var originalIcon = icon ? icon.textContent : '';
        if (label) label.textContent = 'Copied';
        if (icon) icon.textContent = '\u2713';
        btn.classList.add('is-copied');
        setTimeout(function () {
          if (label) label.textContent = originalLabel;
          if (icon) icon.textContent = originalIcon;
          btn.classList.remove('is-copied');
        }, 1600);
      });
    });
  });
})();
`

async function main() {
  const cssPath = path.join(ROOT, 'src/app/headless/headless.css')
  const logoPath = path.join(ROOT, 'public/images/Loop-Vesper-Mint.svg')

  const [css, brandSvg] = await Promise.all([
    fs.readFile(cssPath, 'utf8'),
    fs.readFile(logoPath, 'utf8'),
  ])

  // Strip the XML preamble if present so the SVG can be inlined as JSX-style markup.
  const inlineSvg = brandSvg
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .trim()

  const html = `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vesper Headless · Static export</title>
  <meta name="description" content="Static snapshot of the Vesper Headless landing page for sharing offline. Open the live page to actually generate a connector URL." />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${BASE_TOKENS_CSS}${css}</style>
</head>
<body>
  <div class="vh-shell">
    ${renderNav(inlineSvg)}
    <main>
      ${renderHero()}
      ${renderEngine()}
      ${renderSurfaces()}
      ${renderClose()}
    </main>
    ${renderFooter()}
  </div>
  <script>${RUNTIME_JS}</script>
</body>
</html>`

  await fs.mkdir(OUT_DIR, { recursive: true })
  await fs.writeFile(OUT_FILE, html, 'utf8')
  const size = (await fs.stat(OUT_FILE)).size
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUT_FILE} (${(size / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
