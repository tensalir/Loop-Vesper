'use client'

import { useMemo, useState } from 'react'
import { surfaces, surfacesSection, type Surface, type SurfaceId } from './content'

/**
 * Interactive surface picker. Left rail lists the four surfaces; right
 * panel swaps to show how a call into that surface looks. The MCP
 * surface is marked `status: 'recommended'` in `content.ts` and gets a
 * persistent soft-green fill plus a "Recommended" badge so the eye
 * lands on it first; the other three are intentionally muted.
 *
 * State is local — the page is read-only, no analytics, no URL sync.
 * Keyboard, mouse, and screen-readers all use the same `<button>`
 * semantics; the live region announces panel changes.
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
        <pre className="vh-surfaces__panel-body">
          {active.detail.lines.map((line, idx) => {
            const trimmed = line.trim()
            const isComment = trimmed.startsWith('//')
            return (
              <span key={idx} className={isComment ? 'vh-line--c' : undefined}>
                {line || '\u00a0'}
              </span>
            )
          })}
        </pre>
        <p className="vh-surfaces__panel-who">
          <span className="sr-only">{surfacesSection.panelLabel} · </span>
          {active.who}
        </p>
      </div>
    </div>
  )
}
