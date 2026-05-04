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
  useSection,
  why,
} from './content'
import { SurfacesSelector } from './SurfacesSelector'
import './headless.css'

export const metadata = {
  title: 'Vesper Headless · The creative engine behind the workspace',
  description:
    'A private overview of the Vesper headless creative engine — REST API and MCP for partners and integrators inside Loop.',
  robots: { index: false, follow: false },
}

// Always re-evaluate the auth + access check on each request. The page
// is private and tiny, so SSR per-request is the safest posture.
export const dynamic = 'force-dynamic'

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
 */
async function requireHeadlessAccess() {
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
    },
  })

  if (!profile || profile.deletedAt || profile.pausedAt) {
    redirect('/login')
  }

  const hasAccess = profile.role === 'admin' || profile.headlessAccess === true
  if (!hasAccess) {
    redirect('/projects')
  }
}

export default async function HeadlessPage() {
  await requireHeadlessAccess()

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
                {hero.titlePre} <em>{hero.titleEm}</em>
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

            <aside className="vh-hero__panel" aria-label="Vesper engine overview">
              <span className="vh-hero__panel-halo" aria-hidden="true" />
              <header className="vh-hero__panel-head">
                <span className="vh-hero__panel-dot" aria-hidden="true" />
                <span className="vh-hero__panel-label">One engine · four surfaces</span>
                <span className="vh-hero__panel-live">Live</span>
              </header>
              <div className="vh-orbit" aria-hidden="true">
                <span className="vh-orbit__ring vh-orbit__ring--outer" />
                <span className="vh-orbit__ring vh-orbit__ring--inner" />
                <span className="vh-orbit__pill vh-orbit__pill--top">
                  <span className="vh-orbit__pill-dot" />
                  <span>Web app</span>
                </span>
                <span className="vh-orbit__pill vh-orbit__pill--right">
                  <span className="vh-orbit__pill-dot" />
                  <span>REST API</span>
                </span>
                <span className="vh-orbit__pill vh-orbit__pill--bottom-left">
                  <span className="vh-orbit__pill-dot" />
                  <span>MCP</span>
                </span>
                <span className="vh-orbit__pill vh-orbit__pill--bottom-right">
                  <span className="vh-orbit__pill-dot" />
                  <span>Skill</span>
                </span>
                <span className="vh-orbit__core">
                  <strong>Vesper engine</strong>
                  <span>Substrate</span>
                </span>
              </div>
            </aside>
          </div>
        </section>

        {/* Why headless */}
        <section className="vh-section vh-section--soft" id="why">
          <div className="vh-wrap">
            <header className="vh-section-head">
              <p className="vh-section-eyebrow">{why.eyebrow}</p>
              <h2 className="vh-section-title">
                {why.title} <em>{why.titleEm}</em>
              </h2>
              <p className="vh-section-intro">{why.lede}</p>
            </header>
            <div className="vh-why-grid">
              {why.points.map((point, idx) => (
                <article key={point.id} className="vh-why-card">
                  <span className="vh-why-card__num">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="vh-why-card__title">{point.title}</h3>
                  <p className="vh-why-card__body">{point.body}</p>
                </article>
              ))}
            </div>
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

            <SurfacesSelector />

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

        {/* Use it */}
        <section className="vh-section" id="use">
          <div className="vh-wrap">
            <header className="vh-section-head">
              <p className="vh-section-eyebrow">{useSection.eyebrow}</p>
              <h2 className="vh-section-title">
                {useSection.title} <em>{useSection.titleEm}</em>
              </h2>
              <p className="vh-section-intro">{useSection.lede}</p>
            </header>

            <ol className="vh-steps">
              {useSection.steps.map((step) => (
                <li key={step.n} className="vh-step">
                  <span className="vh-step__n">{step.n}</span>
                  <div>
                    <h3 className="vh-step__title">{step.title}</h3>
                    <p className="vh-step__body">{step.body}</p>
                  </div>
                  {step.detail && (
                    <code className="vh-step__detail">{step.detail}</code>
                  )}
                </li>
              ))}
            </ol>

            <p className="vh-use__footnote">
              {useSection.footnote.split('`').map((segment, idx) =>
                idx % 2 === 1 ? <code key={idx}>{segment}</code> : <span key={idx}>{segment}</span>
              )}
            </p>
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
