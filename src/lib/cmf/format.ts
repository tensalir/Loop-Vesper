/**
 * Display-formatting helpers for the CMF surfaces.
 *
 * Lives under `lib/cmf/` so both server and client modules can import it
 * without bringing React or any browser-only globals along. Kept tiny on
 * purpose — anything heavier (locale-aware formatting, intl plurals)
 * should land in a dedicated module rather than growing this file.
 */

/**
 * Compact relative-time string — `"just now" | "2m ago" | "3h ago" | "5d
 * ago" | "2mo ago"`.
 *
 * Returns `''` (not `null`) when the input is missing/invalid so JSX can
 * interpolate the result without an extra `&&` guard. Callers that want
 * to hide the entire surrounding line should branch on the source value
 * (e.g. `packet.updatedAt && <>...{timeAgo(packet.updatedAt)}</>`)
 * before calling — that's already the pattern in the workspace identity
 * strip and the products dialog packet rows.
 *
 * Mirrors the duplicate definitions that previously lived in
 * `CmfPacketWorkspace.tsx` and `CmfProductsDialog.tsx`. The only
 * behavioural difference vs the products-dialog version was that one
 * returned `null` for missing input — we standardise on `''` so JSX
 * interpolation stays clean.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}
