/**
 * Vesper's GitHub App: the identity Vesper reads the plugin kits with.
 *
 * The App ("Vesper Loop") has Contents: read and Metadata: read, and nothing else:
 * feedback no longer goes through Vesper (2026-09-29), so it files no issues. It is
 * installed on `tensalir/loop-ai-studio` (the studio kit) and
 * `tensalir/loop-product-plugins` (the product kit, read through
 * `repositoryInstallationTokens`). Each token is asked for with exactly those permissions
 * and one repository, so a token that leaks can do nothing else; tokens are cached until
 * five minutes before GitHub expires them (an hour after issue). Asking for a permission
 * the App lacks makes GitHub refuse the whole token (422), which stops every kit read.
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_B64 (the PEM, base64 on one line),
 * GITHUB_APP_INSTALLATION_ID. None of them is read at import time.
 */

import jwt from 'jsonwebtoken'

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_API_VERSION = '2022-11-28'

/** What the installation token is scoped to; the App's own settings must allow at least this. */
export const INSTALLATION_PERMISSIONS = { contents: 'read', metadata: 'read' } as const
/** A token that only reads a repository's files: both kits' tokens are read-only now. */
export const READ_PERMISSIONS = INSTALLATION_PERMISSIONS
/** Refresh this long before GitHub's expiry, so a call never starts on a token about to lapse. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface GithubAppConfig {
  appId: string
  privateKeyPem: string
  installationId: string
  /** The repository names (not owner/name) the token is limited to. */
  repositories: string[]
  /** The permissions asked for; `INSTALLATION_PERMISSIONS` when not given. */
  permissions?: Readonly<Record<string, string>>
}

export class GithubAppNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`Vesper's GitHub App is not configured: ${missing.join(', ')} not set.`)
    this.name = 'GithubAppNotConfigured'
  }
}

/** The config from the environment, or null when any part is missing. */
export function githubAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GithubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim()
  const keyB64 = env.GITHUB_APP_PRIVATE_KEY_B64?.trim()
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim()
  if (!appId || !keyB64 || !installationId) return null
  const repo = (env.CREATIVE_KIT_REPO || 'tensalir/loop-ai-studio').split('/').pop() || 'loop-ai-studio'
  return {
    appId,
    privateKeyPem: Buffer.from(keyB64, 'base64').toString('utf8'),
    installationId,
    repositories: [repo],
  }
}

export function missingGithubAppEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY_B64', 'GITHUB_APP_INSTALLATION_ID'].filter((k) => !env[k]?.trim())
}

/**
 * The App's own JWT: RS256, issued a minute in the past (GitHub's clock may be
 * behind ours) and valid nine minutes (GitHub accepts at most ten).
 */
export function appJwt(config: Pick<GithubAppConfig, 'appId' | 'privateKeyPem'>, nowMs: number = Date.now()): string {
  const now = Math.floor(nowMs / 1000)
  return jwt.sign({ iat: now - 60, exp: now + 540, iss: config.appId }, config.privateKeyPem, { algorithm: 'RS256' })
}

interface CachedToken {
  token: string
  expiresAtMs: number
}

export interface InstallationTokenDeps {
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * Installation tokens, one cache per config. `getToken()` returns the cached
 * token while it has more than the margin left, else asks GitHub for a new one.
 */
export class InstallationTokenCache {
  private cached: CachedToken | null = null
  private inflight: Promise<string> | null = null
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(private readonly config: GithubAppConfig, deps: InstallationTokenDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.now = deps.now ?? Date.now
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return this.cached.token
    }
    if (!this.inflight) {
      this.inflight = this.mint().finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  /** Forget the token, e.g. after GitHub answered 401 with it. */
  invalidate(): void {
    this.cached = null
  }

  private async mint(): Promise<string> {
    const res = await this.fetchImpl(
      `${GITHUB_API}/app/installations/${encodeURIComponent(this.config.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${appJwt(this.config, this.now())}`,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repositories: this.config.repositories, permissions: this.config.permissions ?? INSTALLATION_PERMISSIONS }),
      }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`GitHub refused an installation token (${res.status}): ${text.slice(0, 200)}`)
    }
    const body = (await res.json()) as { token?: string; expires_at?: string }
    if (!body.token || !body.expires_at) {
      throw new Error('GitHub answered an installation token request without a token.')
    }
    this.cached = { token: body.token, expiresAtMs: Date.parse(body.expires_at) }
    return body.token
  }
}

let shared: { key: string; cache: InstallationTokenCache } | null = null

/** The process-wide token cache for the configured App, or null when it is not configured. */
export function sharedInstallationTokens(env: NodeJS.ProcessEnv = process.env): InstallationTokenCache | null {
  const config = githubAppConfigFromEnv(env)
  if (!config) return null
  const key = `${config.appId}:${config.installationId}:${config.repositories.join(',')}`
  if (!shared || shared.key !== key) {
    shared = { key, cache: new InstallationTokenCache(config) }
  }
  return shared.cache
}

const perRepository = new Map<string, InstallationTokenCache>()

/**
 * A token cache for one more repository the App is installed on, read-only unless other permissions
 * are named: the product kit's repository (`PRODUCT_KIT_REPO`). Kept apart from the shared cache,
 * so an installation that does not include that repository yet refuses only this token, never the
 * creative kit's. Null when the App is not configured.
 */
export function repositoryInstallationTokens(
  env: NodeJS.ProcessEnv,
  repository: string,
  permissions: Readonly<Record<string, string>> = READ_PERMISSIONS
): InstallationTokenCache | null {
  const base = githubAppConfigFromEnv(env)
  if (!base) return null
  const name = repository.split('/').pop() || repository
  const key = `${base.appId}:${base.installationId}:${name}:${JSON.stringify(permissions)}`
  let cache = perRepository.get(key)
  if (!cache) {
    cache = new InstallationTokenCache({ ...base, repositories: [name], permissions })
    perRepository.set(key, cache)
  }
  return cache
}
