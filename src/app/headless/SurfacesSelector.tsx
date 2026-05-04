'use client'

import { useMemo, useState } from 'react'
import { surfaces, surfacesSection, type Surface, type SurfaceId } from './content'

/**
 * Interactive surface picker. Left rail lists the four surfaces; right
 * panel swaps to show how a call into that surface looks. State is
 * intentionally local — the page is read-only, no analytics, no URL
 * sync. Keyboard, mouse, and screen-readers all use the same
 * `<button>` semantics; the live region announces panel changes.
 */
export function SurfacesSelector() {
  const [activeId, setActiveId] = useState<SurfaceId>(surfaces[0]?.id ?? 'web')

  const active = useMemo<Surface>(
    () => surfaces.find((s) => s.id === activeId) ?? surfaces[0],
    [activeId]
  )

  return (
    <div className="vh-surfaces">
      <ul className="vh-surfaces__list" role="tablist" aria-label="Vesper surfaces">
        {surfaces.map((surface) => {
          const isActive = surface.id === activeId
          return (
            <li key={surface.id}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`vh-surface-panel-${surface.id}`}
                id={`vh-surface-tab-${surface.id}`}
                className={`vh-surfaces__option${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveId(surface.id)}
              >
                <span className="vh-surfaces__icon" aria-hidden="true">
                  {surface.icon}
                </span>
                <span className="vh-surfaces__copy">
                  <span className="vh-surfaces__name">{surface.name}</span>
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
        className="vh-surfaces__panel"
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
