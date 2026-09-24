/**
 * The creative kit in production: GitHub through Vesper's App, kept in the
 * database. Everything that serves a kit to a tool goes through here.
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_B64, GITHUB_APP_INSTALLATION_ID
 * (the App), CREATIVE_KIT_REPO (default tensalir/loop-asset-reviewer),
 * CREATIVE_KIT_REF (a tag, branch or commit; default: the newest
 * creative-v* tag), CREATIVE_TOOLS_ENABLED=0 (hide every creative tool).
 */

import { githubAppConfigFromEnv, missingGithubAppEnv, sharedInstallationTokens } from '@/lib/github/app'
import { githubClient } from '@/lib/github/rest'
import { githubKitSource } from './kit-github'
import { prismaKitStore } from './kit-store'
import { clearKitMemory, getKitFile, loadCreativeKit, type KitLoaderDeps, type LoadedKit } from './kit'
import type { KitPrompting } from '@/lib/prompts/prompting-source'

export const DEFAULT_KIT_REPO = 'tensalir/loop-asset-reviewer'

export class CreativeKitUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CreativeKitUnavailable'
  }
}

export function creativeToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CREATIVE_TOOLS_ENABLED !== '0'
}

export function kitRepo(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CREATIVE_KIT_REPO || DEFAULT_KIT_REPO).trim()
}

export function productionKitDeps(env: NodeJS.ProcessEnv = process.env): KitLoaderDeps {
  const tokens = sharedInstallationTokens(env)
  if (!tokens) {
    throw new CreativeKitUnavailable(
      `Vesper cannot read the creative kit: ${missingGithubAppEnv(env).join(', ')} not set. An admin sets up Vesper's GitHub App (docs in the pull request that added it).`
    )
  }
  return {
    source: githubKitSource(githubClient({ tokens }), kitRepo(env)),
    store: prismaKitStore,
    ref: env.CREATIVE_KIT_REF?.trim() || null,
  }
}

/** The kit to use now, or a readable error. */
export async function getCreativeKit(opts: { force?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<LoadedKit> {
  const env = opts.env ?? process.env
  if (!creativeToolsEnabled(env)) {
    throw new CreativeKitUnavailable('The creative tools are switched off on this Vesper (CREATIVE_TOOLS_ENABLED=0).')
  }
  if (opts.force) clearKitMemory()
  return loadCreativeKit(productionKitDeps(env), { force: opts.force })
}

/** A file the kit names, verified. */
export async function readKitFile(loaded: LoadedKit, file: { path: string; sha256: string }): Promise<Buffer> {
  return getKitFile(loaded, file, productionKitDeps())
}

/**
 * The Loop edition of the prompting skill from the kit, for the prompt
 * rewrite. Null when the App is not configured or no kit can be read, so the
 * rewrite falls through to its other sources and never fails on the kit.
 */
export async function loadKitPrompting(env: NodeJS.ProcessEnv = process.env): Promise<KitPrompting | null> {
  if (!githubAppConfigFromEnv(env) || !creativeToolsEnabled(env)) return null
  try {
    const loaded = await getCreativeKit({ env })
    const p = loaded.kit.prompting
    if (!p) return null
    return {
      text: p.skill_body,
      version: `creative ${loaded.kit.version} (genai-prompting ${p.version ?? '?'})`,
      sha256: p.sha256,
      settings: { temperature: p.settings.temperature, maxTokens: p.settings.max_tokens },
    }
  } catch (err) {
    console.warn('[creative-kit] prompting from the kit is unavailable:', (err as Error).message)
    return null
  }
}
