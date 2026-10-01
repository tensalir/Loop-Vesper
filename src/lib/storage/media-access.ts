/**
 * Who may open a stored render, clip or PDF through /api/storage, beyond being signed in.
 *
 * Signing in is not enough on its own: an account is created by anyone the auth provider lets
 * sign up, and nothing marks an account as approved. So the media route also asks for a
 * confirmed email on one of `MEDIA_ACCESS_DOMAINS` (comma-separated, exact match, no
 * subdomains; default `loopearplugs.com`), or the admin role. `MEDIA_ACCESS_DOMAINS=*` switches
 * the domain rule off and leaves only the sign-in check.
 *
 * `MEDIA_ACCESS_EMAILS` (comma-separated, exact address) lets one confirmed person in whose
 * address is on no allowed domain. Added 2026-10-01: a long-time colleague signs in with a
 * gmail.com address, and opening gmail.com would open stored media to anyone who signs up.
 */

export const DEFAULT_MEDIA_ACCESS_DOMAINS = ['loopearplugs.com']

export interface MediaAccessUser {
  email?: string | null
  email_confirmed_at?: string | null
}

export function mediaAccessDomains(env: NodeJS.ProcessEnv = process.env): string[] | '*' {
  const raw = env.MEDIA_ACCESS_DOMAINS
  if (raw === undefined || raw.trim() === '') return DEFAULT_MEDIA_ACCESS_DOMAINS
  if (raw.trim() === '*') return '*'
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

export function mediaAccessEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MEDIA_ACCESS_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** null when the person may open stored media; otherwise the reason, for a 403. */
export function mediaAccessProblem(
  user: MediaAccessUser,
  role: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (role === 'admin') return null
  const domains = mediaAccessDomains(env)
  if (domains === '*') return null
  const email = (user.email ?? '').trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 0) return 'Stored media needs an account with a confirmed email on an allowed domain'
  if (!user.email_confirmed_at) return 'Stored media needs a confirmed email address'
  if (mediaAccessEmails(env).includes(email)) return null
  const domain = email.slice(at + 1)
  return domains.includes(domain) ? null : 'Stored media is open to Loop accounts only'
}
