/**
 * The Loop kits in production: GitHub through Vesper's GitHub App, kept in the
 * database. Everything that serves a kit to a tool goes through here.
 *
 *   the creative kit   Loop Studio Design: Eclipse, packaging, prompting
 *   the product kit    Loop Product Design: CMF, and only CMF is read from it
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_B64, GITHUB_APP_INSTALLATION_ID
 * (the App, installed on both repositories), CREATIVE_KIT_REPO (default
 * tensalir/loop-ai-studio), CREATIVE_KIT_REF (a tag, branch or commit;
 * default: the newest studio-design-v* tag), PRODUCT_KIT_REPO (default
 * tensalir/loop-product-plugins), PRODUCT_KIT_REF (default: the newest
 * product-design-v* tag), CREATIVE_TOOLS_ENABLED=0 (hide every creative tool,
 * CMF's included).
 */

import { githubAppConfigFromEnv, missingGithubAppEnv, repositoryInstallationTokens, sharedInstallationTokens } from '@/lib/github/app'
import { githubClient } from '@/lib/github/rest'
import { githubKitSource } from './kit-github'
import { prismaKitStore } from './kit-store'
import {
  clearKitMemory,
  getKitFile,
  kitPaths,
  loadCreativeKit,
  PRODUCT_KIT,
  STUDIO_KIT,
  type KitLoaderDeps,
  type LoadedKit,
} from './kit'
import type { AnyKit, Kit, ProductKit } from './kit-schema'
import type { KitSetLoaders } from './kit-set'
import type { KitPrompting } from '@/lib/prompts/prompting-source'
import { kitGuardWords, type KitGuardWords } from '@/lib/prompts/product-prompt-guard'

export const DEFAULT_KIT_REPO = 'tensalir/loop-ai-studio'
export const DEFAULT_PRODUCT_KIT_REPO = 'tensalir/loop-product-plugins'

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

export function productKitRepo(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PRODUCT_KIT_REPO || DEFAULT_PRODUCT_KIT_REPO).trim()
}

function appMissing(env: NodeJS.ProcessEnv, what: string): CreativeKitUnavailable {
  return new CreativeKitUnavailable(
    `Vesper cannot read the ${what}: ${missingGithubAppEnv(env).join(', ')} not set. An admin sets up Vesper's GitHub App (docs in the pull request that added it).`
  )
}

export function productionKitDeps(env: NodeJS.ProcessEnv = process.env): KitLoaderDeps<Kit> {
  const tokens = sharedInstallationTokens(env)
  if (!tokens) throw appMissing(env, 'creative kit')
  return {
    source: githubKitSource(githubClient({ tokens }), kitRepo(env)),
    store: prismaKitStore,
    ref: env.CREATIVE_KIT_REF?.trim() || null,
    kit: STUDIO_KIT,
  }
}

export function productionProductKitDeps(env: NodeJS.ProcessEnv = process.env): KitLoaderDeps<ProductKit> {
  const repo = productKitRepo(env)
  const tokens = repositoryInstallationTokens(env, repo)
  if (!tokens) throw appMissing(env, 'product kit')
  return {
    source: githubKitSource(githubClient({ tokens }), repo, kitPaths(PRODUCT_KIT.plugin).tagPrefix),
    store: prismaKitStore,
    ref: env.PRODUCT_KIT_REF?.trim() || null,
    kit: PRODUCT_KIT,
  }
}

function assertEnabled(env: NodeJS.ProcessEnv): void {
  if (!creativeToolsEnabled(env)) {
    throw new CreativeKitUnavailable('The creative tools are switched off on this Vesper (CREATIVE_TOOLS_ENABLED=0).')
  }
}

/** The creative kit (Loop Studio Design) to use now, or a readable error. */
export async function getCreativeKit(opts: { force?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<LoadedKit> {
  const env = opts.env ?? process.env
  assertEnabled(env)
  if (opts.force) clearKitMemory(STUDIO_KIT.plugin)
  return loadCreativeKit(productionKitDeps(env), { force: opts.force })
}

/**
 * The product kit (Loop Product Design, CMF) to use now, or a readable error naming where it is
 * read from. There is no CMF without it: Vesper never falls back to a CMF the creative kit still
 * carries.
 */
export async function getProductKit(opts: { force?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<LoadedKit<ProductKit>> {
  const env = opts.env ?? process.env
  assertEnabled(env)
  if (opts.force) clearKitMemory(PRODUCT_KIT.plugin)
  const where = `${productKitRepo(env)} at ${env.PRODUCT_KIT_REF?.trim() || `its newest ${kitPaths(PRODUCT_KIT.plugin).tagPrefix}* tag`} (PRODUCT_KIT_REPO, PRODUCT_KIT_REF)`
  try {
    return await loadCreativeKit(productionProductKitDeps(env), { force: opts.force })
  } catch (err) {
    throw new CreativeKitUnavailable(`CMF is read from Loop Product Design's kit, ${where}, and none can be read: ${(err as Error).message}`)
  }
}

/** Both kits, loaded when asked for: what `./kit-set.ts` resolves a product name against. */
export function productionKitSet(env: NodeJS.ProcessEnv = process.env): KitSetLoaders {
  return { studio: () => getCreativeKit({ env }), product: () => getProductKit({ env }) }
}

/** A file a kit names, verified, read from that kit's own repository. */
export async function readKitFile(loaded: LoadedKit<AnyKit>, file: { path: string; sha256: string }): Promise<Buffer> {
  const deps = loaded.kit.plugin === PRODUCT_KIT.plugin ? productionProductKitDeps() : productionKitDeps()
  return getKitFile(loaded, file, deps)
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

/**
 * The words the prompt guard reads (`src/lib/prompts/product-prompt-guard.ts`): the creative
 * kit's `never_enhance_fingerprints` and its products' own names, and the product kit's
 * CMF template fingerprint. A kit that cannot be read leaves its part null, so the guard uses its
 * own copies for that part and never fails on a kit. Null when the App is not configured.
 */
export async function loadKitGuardWords(env: NodeJS.ProcessEnv = process.env): Promise<KitGuardWords | null> {
  if (!githubAppConfigFromEnv(env) || !creativeToolsEnabled(env)) return null
  const [studio, product] = await Promise.allSettled([getCreativeKit({ env }), getProductKit({ env })])
  for (const [what, r] of [['creative kit', studio], ['product kit', product]] as const) {
    if (r.status === 'rejected') console.warn(`[creative-kit] the prompt guard reads its own copy of the ${what}'s words:`, (r.reason as Error)?.message)
  }
  return kitGuardWords(
    studio.status === 'fulfilled' ? studio.value.kit : null,
    product.status === 'fulfilled' ? product.value.kit : null
  )
}
