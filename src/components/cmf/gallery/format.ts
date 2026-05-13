/**
 * Tiny formatting helpers shared across the gallery subtree.
 *
 * `formatDuration` is the only piece both `AttemptCard` and the
 * `InspectLightbox` need; pulled out so the lightbox doesn't have to
 * import from the card module (or vice versa).
 */

export function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}
