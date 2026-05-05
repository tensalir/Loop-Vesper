import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  close,
  engine,
  footer,
  hero,
  nav,
  surfacesFoot,
  surfacesSection,
} from './content'
import { SurfacesSelector } from './SurfacesSelector'
import './headless.css'

export const metadata = {
  title: 'Vesper Headless · For Loop partners',
  description:
    'A private overview of Vesper Headless: the same image and video workshop the Loop Studio team uses, ready to plug into Claude, Cursor, and your own systems.',
  robots: { index: false, follow: false },
}

// Always re-evaluate the auth + access check on each request. The page
// is private and tiny, so SSR per-request is the safest posture.
export const dynamic = 'force-dynamic'

/**
 * Resolve a friendly first name from a profile + Supabase user, in
 * order of trustworthiness:
 *
 *   1. Profile display name (human-curated, usually properly cased).
 *   2. Supabase OAuth metadata (`full_name` from Google, etc.).
 *   3. `given_name` if the OAuth provider split the name out.
 *   4. Profile username (capitalised).
 *   5. Email local-part before `.`/`_`/`+` (capitalised).
 *
 * Returns `null` when nothing usable is available, so the page can
 * gracefully fall back to its non-personalised team-voice title.
 */
function pickFirstName(
  profile: { displayName: string | null; username: string | null },
  user: {
    email?: string | null
    user_metadata?: Record<string, unknown> | null
  }
): string | null {
  const display = profile.displayName?.trim()
  if (display) return display.split(/\s+/)[0]

  const meta = user.user_metadata ?? {}
  const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
  if (fullName) return fullName.split(/\s+/)[0]

  const givenName =
    typeof meta.given_name === 'string' ? meta.given_name.trim() : ''
  if (givenName) return givenName

  const username = profile.username?.trim()
  if (username) return capitaliseFirstName(username)

  const email = user.email?.trim()
  if (email) {
    const local = email.split('@')[0] ?? ''
    const first = local.split(/[._+]/)[0]
    if (first && first.length >= 2) return capitaliseFirstName(first)
  }

  return null
}

/**
 * Capitalise a name when it is fully upper- or lower-case. Mixed-case
 * names like "DeShawn" or "MacIntosh" are left untouched so we do not
 * butcher capitalisation the user themselves chose.
 */
function capitaliseFirstName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  const allUpper = trimmed === trimmed.toUpperCase()
  const allLower = trimmed === trimmed.toLowerCase()
  if (allUpper || allLower) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }
  return trimmed
}

/**
 * Per-user gate for the /headless page.
 *
 * Middleware already enforces "must be logged in" via Supabase. Here we
 * add the second check: the profile must either have role=admin (admins
 * always see it) or have headlessAccess=true (granted explicitly by an
 * admin from the User Management settings page).
 *
 * Anyone without access is redirected back to /projects rather than
 * shown a "no access" screen — the page is essentially invisible to
 * users who were not given the URL.
 *
 * Returns the verified user id and a resolved first name so the page
 * can render a personalised greeting and fetch per-user data (e.g. the
 * self-issued MCP credential metadata) without re-running the Supabase
 * auth call.
 */
async function requireHeadlessAccess(): Promise<{
  userId: string
  firstName: string | null
}> {
  const supabase = createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: {
      role: true,
      headlessAccess: true,
      pausedAt: true,
      deletedAt: true,
      displayName: true,
      username: true,
    },
  })

  if (!profile || profile.deletedAt || profile.pausedAt) {
    redirect('/login')
  }

  const hasAccess = profile.role === 'admin' || profile.headlessAccess === true
  if (!hasAccess) {
    redirect('/projects')
  }

  const firstName = pickFirstName(
    { displayName: profile.displayName, username: profile.username },
    { email: user.email, user_metadata: user.user_metadata }
  )

  return { userId: user.id, firstName }
}

/**
 * Fetch metadata about the user's self-issued MCP credential, if any.
 * Mirrors the `Self-issued (vesper-headless)` name used by the
 * `/api/me/headless-credential` endpoint so the user-facing flow only
 * touches credentials it created itself, never admin-issued ones.
 */
async function getSelfIssuedCredential(userId: string) {
  const credential = await prisma.headlessCredential.findFirst({
    where: {
      ownerId: userId,
      name: 'Self-issued (vesper-headless)',
      revokedAt: null,
    },
    select: {
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!credential) return null

  return {
    tokenPrefix: credential.tokenPrefix,
    createdAt: credential.createdAt.toISOString(),
    lastUsedAt: credential.lastUsedAt
      ? credential.lastUsedAt.toISOString()
      : null,
  }
}

export type McpAccessSummary = Awaited<ReturnType<typeof getSelfIssuedCredential>>

export default async function HeadlessPage() {
  const { userId, firstName } = await requireHeadlessAccess()
  const mcpAccess = await getSelfIssuedCredential(userId)

  return (
    <div className="vh-shell">
      <header className="vh-nav">
        <div className="vh-wrap vh-nav__inner">
          <Link href="/headless" className="vh-nav__brand">
            <Image
              src="/images/Loop-Vesper-Mint.svg"
              alt="Loop Vesper"
              width={108}
              height={28}
              priority
              className="vh-nav__brand-mark"
            />
            <span className="vh-nav__brand-divider" aria-hidden="true" />
            <span className="vh-nav__brand-sub">{nav.brandSub}</span>
          </Link>
          <nav className="vh-nav__links" aria-label="Page sections">
            {nav.links.map((link) => (
              <a key={link.id} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <span className="vh-nav__status">{nav.status}</span>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="vh-hero">
          <div className="vh-wrap vh-hero__grid">
            <div className="vh-hero__text">
              <p className="vh-eyebrow">
                <span className="vh-eyebrow__pulse" aria-hidden="true" />
                <span>{hero.eyebrow}</span>
              </p>
              <h1 className="vh-hero__title">
                {firstName ? (
                  <>
                    Hi {firstName}, {hero.titlePersonalPre}{' '}
                    <em>{hero.titleEm}</em>
                  </>
                ) : (
                  <>
                    {hero.titlePre} <em>{hero.titleEm}</em>
                  </>
                )}
              </h1>
              <p className="vh-hero__lede">{hero.lede}</p>
              <dl className="vh-hero__meta">
                {hero.meta.map((cell) => (
                  <div key={cell.k} className="vh-hero__meta-cell">
                    <dt>{cell.k}</dt>
                    <dd>{cell.v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <aside className="vh-hero__panel" aria-label="Where Vesper shows up">
              <span className="vh-hero__panel-halo" aria-hidden="true" />
              <header className="vh-hero__panel-head">
                <span className="vh-hero__panel-dot" aria-hidden="true" />
                <span className="vh-hero__panel-label">One Vesper · four ways in</span>
                <span className="vh-hero__panel-live">Live</span>
              </header>
              <div className="vh-orbit" aria-hidden="true">
                <span className="vh-orbit__ring vh-orbit__ring--outer" />
                <span className="vh-orbit__ring vh-orbit__ring--inner" />
                <span className="vh-orbit__pill vh-orbit__pill--top vh-orbit__pill--primary">
                  <span className="vh-orbit__pill-dot" />
                  <span>Connector</span>
                </span>
                <span className="vh-orbit__pill vh-orbit__pill--right">
                  <span className="vh-orbit__pill-dot" />
                  <span>REST API</span>
                </span>
                <span className="vh-orbit__pill vh-orbit__pill--bottom-left">
                  <span className="vh-orbit__pill-dot" />
                  <span>Web app</span>
                </span>
                <span className="vh-orbit__pill vh-orbit__pill--bottom-right">
                  <span className="vh-orbit__pill-dot" />
                  <span>Skill</span>
                </span>
                <span className="vh-orbit__core">
                  <strong>Vesper</strong>
                  <span>Loop know-how</span>
                </span>
              </div>
            </aside>
          </div>
        </section>

        {/* The engine */}
        <section className="vh-section" id="engine">
          <div className="vh-wrap">
            <header className="vh-section-head">
              <p className="vh-section-eyebrow">{engine.eyebrow}</p>
              <h2 className="vh-section-title">
                {engine.title} <em>{engine.titleEm}</em>
              </h2>
              <p className="vh-section-intro">{engine.lede}</p>
            </header>

            <div className="vh-engine">
              <header className="vh-engine__head">
                <strong>{engine.panelTitle}</strong>
                <span className="vh-engine__badge">{engine.panelBadge}</span>
              </header>
              <div className="vh-engine__grid">
                <div className="vh-engine__col">
                  <p className="vh-engine__col-h">{engine.inputsHeading}</p>
                  <ul className="vh-engine__layers">
                    {engine.layers.map((layer) => (
                      <li key={layer.id} className="vh-engine__layer">
                        <span className="vh-engine__layer-tag">{layer.tag}</span>
                        <span className="vh-engine__layer-name">{layer.name}</span>
                        <span className="vh-engine__layer-meta">{layer.meta}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="vh-engine__arrow" aria-hidden="true">
                  <span className="vh-engine__arrow-line" />
                </div>
                <div className="vh-engine__col">
                  <p className="vh-engine__col-h">{engine.outputsHeading}</p>
                  <ul className="vh-engine__capabilities">
                    {engine.capabilities.map((capability) => (
                      <li key={capability.id} className="vh-engine__capability">
                        <h3 className="vh-engine__capability-title">
                          {capability.title}
                        </h3>
                        <p className="vh-engine__capability-body">{capability.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Surfaces */}
        <section className="vh-section vh-section--soft" id="surfaces">
          <div className="vh-wrap">
            <header className="vh-section-head">
              <p className="vh-section-eyebrow">{surfacesSection.eyebrow}</p>
              <h2 className="vh-section-title">
                {surfacesSection.title} <em>{surfacesSection.titleEm}</em>
              </h2>
              <p className="vh-section-intro">{surfacesSection.lede}</p>
            </header>

            <SurfacesSelector mcpAccess={mcpAccess} />

            <ul className="vh-surfaces__foot">
              {surfacesFoot.map((point) => (
                <li key={point.id} className="vh-surfaces__foot-item">
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Close */}
        <section className="vh-section" id="cta">
          <div className="vh-wrap vh-close">
            <p className="vh-section-eyebrow">{close.eyebrow}</p>
            <h2 className="vh-close__title">
              {close.title} <em>{close.titleEm}</em>
            </h2>
            <p className="vh-close__lede">{close.lede}</p>
            <div className="vh-actions">
              <a className="vh-btn vh-btn--primary" href={close.primary.href}>
                {close.primary.label}
                <span aria-hidden="true">→</span>
              </a>
              <a className="vh-btn vh-btn--ghost" href={close.secondary.href}>
                {close.secondary.label}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="vh-footer">
        <div className="vh-wrap vh-footer__inner">
          <span>{footer.line}</span>
          <span>{footer.signature}</span>
        </div>
      </footer>
    </div>
  )
}
