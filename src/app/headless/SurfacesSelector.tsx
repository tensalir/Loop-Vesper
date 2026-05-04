'use client'

import { useMemo, useState } from 'react'
import { surfaces, surfacesSection, type Surface, type SurfaceId } from './content'

/**
 * Interactive surface picker for the /headless landing page.
 *
 * Left rail lists the surfaces; right panel renders a clean detail view:
 * an intro paragraph, copy-pasteable fields for the values a partner
 * needs, plain-language install steps, and an optional footnote.
 *
 * The MCP surface is `status: 'recommended'` in `content.ts` and gets a
 * persistent soft-mint fill plus a "Recommended" badge so the eye lands
 * on it first; the others are intentionally muted.
 *
 * State is local — no analytics, no URL sync. Keyboard, mouse, and
 * screen readers all use the same `<button>` semantics; the panel is an
 * `aria-live` region so swaps are announced.
 */
export function SurfacesSelector() {
  const initialId: SurfaceId =
    surfaces.find((s) => s.status === 'recommended')?.id ??
    surfaces[0]?.id ??
    'mcp'

  const [activeId, setActiveId] = useState<SurfaceId>(initialId)

  const active = useMemo<Surface>(
    () => surfaces.find((s) => s.id === activeId) ?? surfaces[0],
    [activeId]
  )

  return (
    <div className="vh-surfaces">
      <ul className="vh-surfaces__list" role="tablist" aria-label="Vesper surfaces">
        {surfaces.map((surface) => {
          const isActive = surface.id === activeId
          const classes = [
            'vh-surfaces__option',
            `vh-surfaces__option--${surface.status}`,
            isActive ? 'is-active' : null,
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <li key={surface.id}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`vh-surface-panel-${surface.id}`}
                id={`vh-surface-tab-${surface.id}`}
                className={classes}
                onClick={() => setActiveId(surface.id)}
              >
                <span className="vh-surfaces__icon" aria-hidden="true">
                  {surface.icon}
                </span>
                <span className="vh-surfaces__copy">
                  <span className="vh-surfaces__name-row">
                    <span className="vh-surfaces__name">{surface.name}</span>
                    {surface.badge && (
                      <span
                        className={`vh-surfaces__badge vh-surfaces__badge--${surface.status}`}
                      >
                        {surface.badge}
                      </span>
                    )}
                  </span>
                  <span className="vh-surfaces__verb">{surface.verb}</span>
                </span>
                <span className="vh-surfaces__caret" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div
        className={`vh-surfaces__panel vh-surfaces__panel--${active.status}`}
        role="tabpanel"
        id={`vh-surface-panel-${active.id}`}
        aria-labelledby={`vh-surface-tab-${active.id}`}
        aria-live="polite"
      >
        <header className="vh-surfaces__panel-head">
          <span className="vh-surfaces__panel-title">{active.detail.title}</span>
          <span className="vh-surfaces__panel-meta">{active.detail.meta}</span>
        </header>

        <div className="vh-surfaces__panel-body">
          {active.detail.body && (
            <p className="vh-panel-prose">{active.detail.body}</p>
          )}

          {active.detail.fields && active.detail.fields.length > 0 && (
            <ul className="vh-fields" role="list">
              {active.detail.fields.map((field) => (
                <li key={field.label} className="vh-field">
                  <label className="vh-field__label">{field.label}</label>
                  <div className="vh-field__row">
                    <code className="vh-field__value">{field.value}</code>
                    <CopyButton value={field.value} label={field.label} />
                  </div>
                  {field.hint && <p className="vh-field__hint">{field.hint}</p>}
                </li>
              ))}
            </ul>
          )}

          {active.detail.instructions &&
            active.detail.instructions.length > 0 && (
              <div className="vh-how">
                <p className="vh-how__h">How to install</p>
                <ol className="vh-how__steps">
                  {active.detail.instructions.map((step, idx) => (
                    <li key={idx} className="vh-how__step">
                      <span className="vh-how__num" aria-hidden="true">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="vh-how__copy">
                        <p className="vh-how__main">{step.main}</p>
                        {step.detail && (
                          <p className="vh-how__detail">{step.detail}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

          {active.detail.action && (
            <div className="vh-action">
              <a
                className="vh-action__btn"
                href={active.detail.action.href}
                {...(active.detail.action.filename
                  ? { download: active.detail.action.filename }
                  : {})}
              >
                <span aria-hidden="true" className="vh-action__icon">
                  ↓
                </span>
                <span>{active.detail.action.label}</span>
              </a>
              {active.detail.action.hint && (
                <p className="vh-action__hint">{active.detail.action.hint}</p>
              )}
            </div>
          )}

          {active.detail.footnote && (
            <p className="vh-panel-foot">
              <span className="sr-only">{surfacesSection.panelLabel}. </span>
              {active.detail.footnote}
            </p>
          )}
        </div>

        <p className="vh-surfaces__panel-who">
          <span className="sr-only">{surfacesSection.panelLabel} · </span>
          {active.who}
        </p>
      </div>
    </div>
  )
}

/**
 * One-click copy button for a single field value.
 *
 * Uses the Clipboard API and shows a brief "Copied" state so the user
 * knows the action landed. Failures are silent — the value is still
 * visible and can be selected manually.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // No-op: the value is selectable in the page so a user can still
      // copy manually if their browser blocks the Clipboard API.
    }
  }

  return (
    <button
      type="button"
      className={`vh-copy${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
    >
      <span aria-hidden="true" className="vh-copy__icon">
        {copied ? '✓' : '⧉'}
      </span>
      <span className="vh-copy__label">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}
