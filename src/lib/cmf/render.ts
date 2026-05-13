/**
 * CMF render service.
 *
 * Given a `CmfRender` row id, this service:
 *   1. Creates a fresh `CmfRenderAttempt` row tied to that SKU.
 *   2. Builds the deterministic CMF recolour prompt from the row.
 *   3. Looks up the clown reference image (uploaded asset or product render).
 *   4. Asks `enhancePrompt` to polish the prompt for Nano Banana–style models.
 *   5. Calls the model adapter through the existing Vesper pattern.
 *   6. Persists the rendered image into Supabase Storage and updates the
 *      attempt row.
 *   7. Mirrors the attempt onto the parent `CmfRender` row so legacy
 *      consumers (PDF, listing endpoints) keep reading `renderUrl` as
 *      "current SKU image". The render's `selectedAttemptId` always points
 *      at the canonical attempt (newest by default; approval moves it).
 *
 * Multiple attempts per SKU are intentional: Nano Banana is variable, so
 * the skill recommends 3–5 attempts and lets the designer approve one.
 */

import { prisma } from '@/lib/prisma'
import { getModel, getModelConfig } from '@/lib/models/registry'
import { enhancePrompt } from '@/lib/prompts/enhance'
import { downloadReferenceImageAsDataUrl } from '@/lib/reference-images'
import {
  uploadBase64ToStorage,
  uploadUrlToStorage,
} from '@/lib/supabase/storage'
import {
  CMF_STORAGE_BUCKET,
  publicUrlForCmfStoragePath,
  renderStoragePath,
} from './storage'
import { buildCmfPrompt } from './prompt'
import type { CmfSkuRow, ComponentSpec, PaletteSwatch } from './schema'
import { getCmfProduct } from './products'

const DEFAULT_MODEL_ID = 'gemini-nano-banana-pro'
const RENDER_TIMEOUT_MS = 60_000
const ALLOWED_MODEL_IDS = new Set([
  'gemini-nano-banana-pro',
  'gemini-nano-banana-2',
  'replicate-seedream-4',
  'replicate-reve',
  'replicate-nano-banana-pro',
])

export class CmfRenderError extends Error {
  category: 'validation' | 'reference' | 'model' | 'storage'
  constructor(category: CmfRenderError['category'], message: string) {
    super(message)
    this.category = category
    this.name = 'CmfRenderError'
  }
}

interface RenderArgs {
  renderId: string
  triggeredByUserId?: string
  /** Iterative refinement: freeform "what to change" instruction.
   *  When set, gets appended to the spec-derived base prompt as a
   *  structured `REFINEMENT INSTRUCTIONS:` section so the model
   *  treats it as overriding guidance rather than a new spec. The
   *  prompt is grounded in the workbook spec either way — chains
   *  don't drift after multiple hops because each refinement
   *  re-derives from the spec, not from the parent's prompt. */
  refinementPrompt?: string
  /** Iterative refinement: id of the attempt this one is refining.
   *  Captured for lineage display ("refines #3 → make it more
   *  holographic") and used to reuse the parent's lighting variant
   *  so a refinement doesn't change two things at once (colour AND
   *  lighting). When omitted with `refinementPrompt` set, we treat
   *  it as a fresh-spec refinement (no anchor) — still valid, the
   *  model just gets the spec + the correction. */
  parentAttemptId?: string
  /** Phase 2 of iterative refinement: storage paths (NOT URLs) of
   *  reference images the designer dropped alongside the refinement
   *  prompt. Resolved to data URLs and passed to the model alongside
   *  the clown reference, with a "REFERENCE IMAGES:" section in the
   *  prompt naming each ref's role. Capped at 4 by the upload route
   *  — we still defensively slice() here so a bad client can't blow
   *  the prompt. */
  referenceImagePaths?: string[]
}

interface ResolvedReferences {
  dataUrls: string[]
  primaryDataUrl: string | null
  /** Which clown the resolver actually picked, for logging + UI surface. */
  resolvedAsset: {
    id: string
    productSlug: string
    variantSlug: string
    label: string
    source: 'explicit' | 'exact-variant' | 'product-fallback'
    /** When `product-fallback`, how many variants the resolver was choosing among. */
    poolSize: number
    /** Per-region colour metadata (when the clown was uploaded with one).
     * Used by `buildCmfPrompt` to address surfaces by their clown colour. */
    components: Array<{ region: string; label: string; colorHex?: string | null }>
  } | null
}

/** Best-effort parser for the `CmfClownAsset.components` JSON column. */
function readClownComponents(
  components: unknown
): Array<{ region: string; label: string; colorHex?: string | null }> {
  if (!Array.isArray(components)) return []
  const out: Array<{ region: string; label: string; colorHex?: string | null }> = []
  for (const entry of components) {
    if (!entry || typeof entry !== 'object') continue
    const region = (entry as { region?: unknown }).region
    const label = (entry as { label?: unknown }).label
    const colorHex =
      (entry as { color_hex?: unknown }).color_hex ??
      (entry as { colorHex?: unknown }).colorHex
    if (typeof region !== 'string' || region.length === 0) continue
    if (typeof label !== 'string' || label.length === 0) continue
    out.push({
      region,
      label,
      colorHex: typeof colorHex === 'string' ? colorHex : null,
    })
  }
  return out
}

async function resolveRowReferences(args: {
  productSlug: string
  variantSlug: string
  clownAssetId: string | null
  /**
   * Monotonic per-SKU attempt counter (1-indexed). When the SKU has no
   * explicit clown linked and the library has multiple clowns for the
   * product, the resolver cycles through them via `(attemptNumber - 1) %
   * pool.length` so every attempt explores a different angle / pose
   * instead of every render landing on the same alphabetically-first
   * variant.
   */
  attemptNumber: number
}): Promise<ResolvedReferences> {
  // Tier 1: explicit clownAssetId on the render row.
  if (args.clownAssetId) {
    const asset = await prisma.cmfClownAsset.findUnique({
      where: { id: args.clownAssetId },
    })
    if (!asset) throw new CmfRenderError('reference', 'Linked clown asset is missing')
    const dataUrl = await downloadReferenceImageAsDataUrl(asset.imageUrl)
    return {
      dataUrls: [dataUrl],
      primaryDataUrl: dataUrl,
      resolvedAsset: {
        id: asset.id,
        productSlug: asset.productSlug,
        variantSlug: asset.variantSlug,
        label: asset.label,
        source: 'explicit',
        poolSize: 1,
        components: readClownComponents(asset.components),
      },
    }
  }

  // Tier 2: exact (productSlug, variantSlug) match.
  const exact = await prisma.cmfClownAsset.findUnique({
    where: {
      productSlug_variantSlug: {
        productSlug: args.productSlug,
        variantSlug: args.variantSlug,
      },
    },
  })
  if (exact) {
    const dataUrl = await downloadReferenceImageAsDataUrl(exact.imageUrl)
    return {
      dataUrls: [dataUrl],
      primaryDataUrl: dataUrl,
      resolvedAsset: {
        id: exact.id,
        productSlug: exact.productSlug,
        variantSlug: exact.variantSlug,
        label: exact.label,
        source: 'exact-variant',
        poolSize: 1,
        components: readClownComponents(exact.components),
      },
    }
  }

  // Tier 3: cycle through every clown for the product so a multi-angle
  // library (e.g. Aphrodite Carry Case ships with 5 angles) produces a
  // real fan instead of all attempts landing on the same alphabetically
  // first variant. Pool ordering is stable so the cycling is reproducible.
  const pool = await prisma.cmfClownAsset.findMany({
    where: { productSlug: args.productSlug },
    orderBy: [{ variantSlug: 'asc' }, { id: 'asc' }],
  })
  if (pool.length > 0) {
    const idx = ((args.attemptNumber - 1) % pool.length + pool.length) % pool.length
    const picked = pool[idx]
    const dataUrl = await downloadReferenceImageAsDataUrl(picked.imageUrl)
    return {
      dataUrls: [dataUrl],
      primaryDataUrl: dataUrl,
      resolvedAsset: {
        id: picked.id,
        productSlug: picked.productSlug,
        variantSlug: picked.variantSlug,
        label: picked.label,
        source: 'product-fallback',
        poolSize: pool.length,
        components: readClownComponents(picked.components),
      },
    }
  }

  throw new CmfRenderError(
    'reference',
    'No clown reference image is available. Upload a clown PNG for this product before rendering.'
  )
}

/**
 * Public-facing metadata about the clown asset that *would* be picked for a
 * given SKU, without downloading the image data URL. Used by the prompt
 * builder (`buildCmfPrompt` clown legend) and the PDF generator (Clown
 * reference page).
 */
export interface ResolvedClownMeta {
  id: string
  label: string
  imageUrl: string
  productSlug: string
  variantSlug: string
  components: Array<{ region: string; label: string; colorHex?: string | null }>
  source: 'explicit' | 'exact-variant' | 'product-fallback'
  /** When `product-fallback`, how many variants the resolver was choosing among. */
  poolSize: number
}

/**
 * Resolve which clown asset *would* be used for a SKU, mirroring the three
 * tiers in `resolveRowReferences` but without downloading the image bytes.
 * Returns null when no clown is registered for the product.
 *
 * Centralised here so the prompt builder, the PDF generator, and any future
 * consumer always reason about the same asset selection rules.
 */
export async function resolveClownAssetForRender(args: {
  productSlug: string
  variantSlug: string
  clownAssetId: string | null
  /** Optional — only used by the product-fallback tier to pick a stable
   * angle for this attempt. Defaults to 1 (no cycling). */
  attemptNumber?: number
}): Promise<ResolvedClownMeta | null> {
  const attemptNumber = args.attemptNumber ?? 1
  try {
    if (args.clownAssetId) {
      const asset = await prisma.cmfClownAsset.findUnique({
        where: { id: args.clownAssetId },
      })
      if (!asset) return null
      return {
        id: asset.id,
        label: asset.label,
        imageUrl: asset.imageUrl,
        productSlug: asset.productSlug,
        variantSlug: asset.variantSlug,
        components: readClownComponents(asset.components),
        source: 'explicit',
        poolSize: 1,
      }
    }

    const exact = await prisma.cmfClownAsset.findUnique({
      where: {
        productSlug_variantSlug: {
          productSlug: args.productSlug,
          variantSlug: args.variantSlug,
        },
      },
    })
    if (exact) {
      return {
        id: exact.id,
        label: exact.label,
        imageUrl: exact.imageUrl,
        productSlug: exact.productSlug,
        variantSlug: exact.variantSlug,
        components: readClownComponents(exact.components),
        source: 'exact-variant',
        poolSize: 1,
      }
    }

    const pool = await prisma.cmfClownAsset.findMany({
      where: { productSlug: args.productSlug },
      orderBy: [{ variantSlug: 'asc' }, { id: 'asc' }],
    })
    if (pool.length === 0) return null
    const idx = ((attemptNumber - 1) % pool.length + pool.length) % pool.length
    const picked = pool[idx]
    return {
      id: picked.id,
      label: picked.label,
      imageUrl: picked.imageUrl,
      productSlug: picked.productSlug,
      variantSlug: picked.variantSlug,
      components: readClownComponents(picked.components),
      source: 'product-fallback',
      poolSize: pool.length,
    }
  } catch (err) {
    // Best-effort: a missing metadata row should never block the render.
    console.warn('[cmf/render] clown resolver failed; falling back to no clown context', err)
    return null
  }
}

/**
 * Backwards-compatible thin wrapper used by `runCmfRender` to keep the
 * existing call site terse. Returns just the per-region colour metadata.
 */
async function peekClownComponents(args: {
  productSlug: string
  variantSlug: string
  clownAssetId: string | null
  attemptNumber: number
}): Promise<Array<{ region: string; label: string; colorHex?: string | null }>> {
  const resolved = await resolveClownAssetForRender(args)
  return resolved?.components ?? []
}

function ensureSupportedModel(modelId: string): string {
  if (!ALLOWED_MODEL_IDS.has(modelId)) {
    throw new CmfRenderError(
      'validation',
      `Model "${modelId}" is not allowed for CMF renders. Use one of: ${Array.from(ALLOWED_MODEL_IDS).join(', ')}`
    )
  }
  return modelId
}

/**
 * Run a single CMF render attempt for one SKU. Creates and updates a
 * `CmfRenderAttempt` row, and mirrors the latest result onto the parent
 * `CmfRender` for backward compatibility with PDF / listing consumers.
 *
 * The caller is responsible for access checks before invoking this.
 */
/**
 * Pure helper: append the refinement instructions to a spec-derived
 * base prompt. Lives outside `runCmfRender` so the test suite can
 * pin its behaviour without spinning up Prisma or the model adapter.
 *
 *   - `refinementPrompt` blank/null → return the base prompt unchanged
 *     so the bulk-burst path keeps producing the original prompt.
 *   - Otherwise append a `REFINEMENT INSTRUCTIONS:` section that
 *     names the correction explicitly and reminds the model to
 *     preserve every other spec detail.
 *   - When `referenceImageCount` > 0, append a `REFERENCE IMAGES:`
 *     section telling the model that the additional images sent
 *     alongside the clown are refinement guidance (not spec). This
 *     keeps the model from confusing them with the canonical
 *     product reference.
 */
export function applyRefinementToPrompt(
  basePrompt: string,
  refinementPrompt?: string | null,
  referenceImageCount = 0
): string {
  const correction = refinementPrompt?.trim()
  let out = basePrompt
  if (correction) {
    out = `${out}\n\nREFINEMENT INSTRUCTIONS:\nThe previous render did not fully capture: ${correction}\nApply this correction while preserving every other spec detail above.`
  }
  if (referenceImageCount > 0) {
    const lines: string[] = []
    lines.push('')
    lines.push('REFERENCE IMAGES:')
    lines.push(
      `The designer attached ${referenceImageCount} reference image${
        referenceImageCount === 1 ? '' : 's'
      } alongside the canonical product reference. Treat ${
        referenceImageCount === 1 ? 'it' : 'them'
      } as guidance for the refinement above (e.g. how a finish, surface, or accent should read), not as a replacement for the product geometry.`
    )
    for (let i = 0; i < referenceImageCount; i++) {
      lines.push(`  Reference ${i + 1}: refinement guidance.`)
    }
    out = `${out}${lines.join('\n')}`
  }
  return out
}

/**
 * Pure helper: pick the lighting variant index for a new attempt.
 * When refining, reuse the parent's variant index so the refinement
 * doesn't accidentally change two things at once (colour AND
 * lighting). When not refining, fall back to the default
 * `attemptNumber - 1` rotation that the bulk burst relies on.
 */
export function pickVariantIndex(args: {
  attemptNumber: number
  parentAttemptNumber?: number | null
  isRefinement: boolean
}): number {
  if (args.isRefinement && typeof args.parentAttemptNumber === 'number') {
    return args.parentAttemptNumber - 1
  }
  return args.attemptNumber - 1
}

/**
 * Refinement-reference safety cap.
 *
 * The upload route already enforces 4 max, but we re-cap here so a
 * direct service caller (CLI, future bulk path) can't sneak in
 * dozens of refs and blow either the prompt size or the model
 * adapter's image-array budget.
 */
const MAX_REFINEMENT_REFERENCES = 4

export async function runCmfRender({
  renderId,
  triggeredByUserId,
  refinementPrompt,
  parentAttemptId,
  referenceImagePaths,
}: RenderArgs) {
  const render = await prisma.cmfRender.findUnique({ where: { id: renderId } })
  if (!render) throw new CmfRenderError('validation', 'Render not found')
  const ownerId = render.ownerId

  const product = getCmfProduct(render.productSlug)
  if (!product) {
    throw new CmfRenderError('validation', `Unknown product slug ${render.productSlug}`)
  }

  const row: CmfSkuRow = {
    label: render.label,
    productSlug: render.productSlug,
    variantSlug: render.variantSlug,
    productCode: render.productCode ?? undefined,
    ean: render.ean ?? undefined,
    colorwayName: render.colorwayName ?? undefined,
    components: (render.componentSpecs as unknown as ComponentSpec[]) ?? [],
    palette: (render.paletteSwatches as unknown as PaletteSwatch[]) ?? [],
  }
  if (!row.components || row.components.length === 0) {
    throw new CmfRenderError(
      'validation',
      'No component specs on this SKU. Add at least one Pantone/material before rendering.'
    )
  }

  const modelId = ensureSupportedModel(render.modelId ?? product.defaultModelId ?? DEFAULT_MODEL_ID)
  // Pre-compute multi-image capability so we can decide *before*
  // building the prompt whether refinement references will actually
  // be sent to the model. This keeps the prompt honest: a model
  // that can't accept multiple images shouldn't see a `REFERENCE
  // IMAGES:` section either.
  const modelSupportsMultiImage = !!getModelConfig(modelId)?.capabilities?.multiImageEditing

  // Allocate the next attempt number — monotonic per SKU so attempt 1 stays
  // attempt 1 even after archiving / restoring.
  const lastAttempt = await prisma.cmfRenderAttempt.findFirst({
    where: { renderId },
    orderBy: { attemptNumber: 'desc' },
    select: { attemptNumber: true },
  })
  const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1

  // Iterative refinement: when the caller passed a parent attempt id,
  // resolve the parent's attemptNumber so we can reuse its lighting
  // variant. Reusing the variant means the refinement only changes
  // ONE thing (the colour/material correction) instead of two
  // (colour AND lighting), which makes model behaviour much easier
  // to reason about.
  const parentAttempt = parentAttemptId
    ? await prisma.cmfRenderAttempt.findUnique({
        where: { id: parentAttemptId },
        select: { attemptNumber: true, renderId: true },
      })
    : null

  // Each attempt explores a different lighting/mood variant so a bulk
  // burst produces a real fan of options. Variant 0 (Studio Classic) is
  // Damien's gold-standard; subsequent attempts cycle through Warm,
  // Clinical, Dramatic, then loop back. Refinements override this and
  // reuse the parent's variant.
  //
  // We also peek at which clown the reference resolver *would* pick so the
  // prompt can address components by their clown colour ("the blue surface
  // on the reference (Cosmetic cap): recolour to …"). Falls back silently
  // when the resolved clown has no per-region colour metadata.
  const variantIndex = pickVariantIndex({
    attemptNumber,
    parentAttemptNumber: parentAttempt?.attemptNumber ?? null,
    isRefinement: Boolean(refinementPrompt?.trim()),
  })
  const clownComponents = await peekClownComponents({
    productSlug: render.productSlug,
    variantSlug: render.variantSlug,
    clownAssetId: render.clownAssetId,
    attemptNumber: variantIndex + 1,
  })
  const { basePrompt: specPrompt, variant } = buildCmfPrompt(row, {
    variantIndex,
    clownComponents,
  })
  // Defensive cap + dedupe of refinement-reference paths. Empty
  // strings filtered out so a sloppy client can't smuggle in a
  // request for an empty download (which would 200 with 0 bytes
  // and then explode in the model adapter).
  const refinementRefPaths = Array.from(
    new Set((referenceImagePaths ?? []).map((p) => p.trim()).filter(Boolean))
  ).slice(0, MAX_REFINEMENT_REFERENCES)
  // Only advertise the references in the prompt if the model can
  // actually accept multiple images. Otherwise we'd be telling the
  // model "look at the 2 reference images attached" while sending
  // it a single image — confusing and wasteful.
  const promptRefCount = modelSupportsMultiImage ? refinementRefPaths.length : 0
  const basePrompt = applyRefinementToPrompt(specPrompt, refinementPrompt, promptRefCount)

  const attempt = await prisma.cmfRenderAttempt.create({
    data: {
      renderId,
      attemptNumber,
      status: 'rendering',
      approvalStatus: 'pending',
      basePrompt,
      modelId,
      triggeredBy: triggeredByUserId ?? null,
      startedAt: new Date(),
      refinementPrompt: refinementPrompt?.trim() || null,
      parentAttemptId: parentAttempt ? parentAttemptId : null,
      referenceImagePaths: refinementRefPaths,
    },
  })

  // Reflect "currently rendering" on the parent SKU so the workspace can
  // surface progress without joining attempts everywhere.
  await prisma.cmfRender.update({
    where: { id: renderId },
    data: {
      status: 'rendering',
      basePrompt,
      modelId,
      attempts: { increment: 1 },
      startedAt: new Date(),
      error: null,
    },
  })

  try {
    const refs = await resolveRowReferences({
      productSlug: render.productSlug,
      variantSlug: render.variantSlug,
      clownAssetId: render.clownAssetId,
      attemptNumber,
    })

    // Resolve the refinement references (uploaded by the designer in
    // the Refine panel) to data URLs. We download them in parallel
    // and tolerate individual failures: a busted CDN response should
    // not silently kill the whole render. If everything fails we
    // surface that as a `reference` error so the caller sees a clear
    // message in the attempt row.
    let refinementRefDataUrls: string[] = []
    if (refinementRefPaths.length > 0) {
      const settled = await Promise.allSettled(
        refinementRefPaths.map((p) =>
          downloadReferenceImageAsDataUrl(publicUrlForCmfStoragePath(p))
        )
      )
      refinementRefDataUrls = settled
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value)
      const failed = settled.length - refinementRefDataUrls.length
      if (failed > 0 && refinementRefDataUrls.length === 0) {
        throw new CmfRenderError(
          'reference',
          `All ${failed} refinement reference image(s) failed to download. Please re-upload.`
        )
      }
      if (failed > 0) {
        console.warn(
          `[cmf/render] ${failed}/${settled.length} refinement references failed to download; continuing with the rest`
        )
      }
    }

    let enhancedPrompt = basePrompt
    try {
      const enhancement = await enhancePrompt({
        prompt: basePrompt,
        modelId,
        referenceImage: refs.primaryDataUrl ?? undefined,
      })
      if (enhancement.enhancedPrompt) enhancedPrompt = enhancement.enhancedPrompt
    } catch (err) {
      console.warn('[cmf/render] prompt enhancement failed, using base prompt', err)
    }

    const adapter = getModel(modelId)
    if (!adapter) throw new CmfRenderError('model', `Unknown model ${modelId}`)

    const config = getModelConfig(modelId)
    const supportsMulti = modelSupportsMultiImage

    // Combine the canonical product reference (clown / fallback)
    // with the optional refinement references. Order matters: the
    // canonical reference comes FIRST so models that treat the
    // first image as the primary subject keep doing so. The
    // refinement refs slot in after as guidance.
    //
    // For models without multi-image support we silently drop the
    // refinement refs rather than swap them in for the clown — the
    // clown is non-negotiable spec, the refinement refs are nice
    // -to-have. The prompt's `REFERENCE IMAGES:` section is also
    // omitted in that case so we don't tell the model about images
    // we never sent.
    const canSendRefinementRefs = supportsMulti && refinementRefDataUrls.length > 0
    const combinedRefs: string[] = canSendRefinementRefs
      ? [...refs.dataUrls, ...refinementRefDataUrls]
      : refs.dataUrls

    if (refinementRefDataUrls.length > 0 && !supportsMulti) {
      console.warn(
        `[cmf/render] model ${modelId} does not support multi-image editing; dropping ${refinementRefDataUrls.length} refinement reference(s)`
      )
    }

    const generation = await Promise.race([
      adapter.generate({
        prompt: enhancedPrompt,
        numOutputs: 1,
        ...(combinedRefs.length > 1 && supportsMulti
          ? { referenceImages: combinedRefs }
          : combinedRefs.length >= 1
          ? { referenceImage: combinedRefs[0] }
          : {}),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new CmfRenderError(
                'model',
                `Render timed out after ${RENDER_TIMEOUT_MS / 1000}s`
              )
            ),
          RENDER_TIMEOUT_MS
        )
      ),
    ])

    if (generation.status !== 'completed' || !generation.outputs?.length) {
      throw new CmfRenderError('model', generation.error || 'Model returned no outputs')
    }

    const output = generation.outputs[0]
    const ext = output.url.includes('image/png') || output.url.endsWith('.png') ? 'png' : 'jpg'
    // Storage path keys each attempt by id so concurrent attempts don't
    // overwrite each other's images.
    const path = renderStoragePath(ownerId, render.packetId, `${renderId}-attempt-${attempt.id}`, ext)
    const persistedUrl = output.url.startsWith('data:')
      ? await uploadBase64ToStorage(output.url, CMF_STORAGE_BUCKET, path)
      : await uploadUrlToStorage(output.url, CMF_STORAGE_BUCKET, path)

    const perImage = config?.pricing?.perImage ?? null

    const completedAttempt = await prisma.cmfRenderAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'ready',
        enhancedPrompt,
        imageUrl: persistedUrl,
        imagePath: path,
        imageWidth: output.width ?? null,
        imageHeight: output.height ?? null,
        completedAt: new Date(),
        costUsd: perImage,
      },
    })

    void variant // surfaced via the return value below

    // Mirror the latest attempt onto the parent SKU. Selection rule:
    //  - If the SKU already has an approved attempt, keep that as the
    //    selected/visible image (do not silently overwrite an approval).
    //  - Otherwise the freshest "ready" attempt becomes the selected image.
    const hasApproved = await prisma.cmfRenderAttempt.findFirst({
      where: { renderId, approvalStatus: 'approved' },
      select: { id: true, imageUrl: true, imagePath: true, imageWidth: true, imageHeight: true },
    })

    const target = hasApproved ?? completedAttempt
    const updated = await prisma.cmfRender.update({
      where: { id: renderId },
      data: {
        status: 'ready',
        renderUrl: target.imageUrl ?? null,
        renderPath: target.imagePath ?? null,
        renderWidth: target.imageWidth ?? null,
        renderHeight: target.imageHeight ?? null,
        selectedAttemptId: target.id,
        enhancedPrompt,
        completedAt: new Date(),
        costUsd: perImage,
      },
    })

    return {
      render: updated,
      attempt: completedAttempt,
      variant,
      clown: refs.resolvedAsset,
    }
  } catch (err) {
    const category = err instanceof CmfRenderError ? err.category : 'model'
    const message = err instanceof Error ? err.message : 'Unknown render error'

    await prisma.cmfRenderAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'failed',
        error: `[${category}] ${message}`,
        completedAt: new Date(),
      },
    })

    // If this was the very first attempt for the SKU and it failed, mark
    // the parent SKU failed too so the workspace surfaces the error.
    // Otherwise keep the SKU on its previous good state — designers expect
    // a re-run to fail without losing their approved image.
    const successfulAttempts = await prisma.cmfRenderAttempt.count({
      where: { renderId, status: 'ready' },
    })
    if (successfulAttempts === 0) {
      await prisma.cmfRender.update({
        where: { id: renderId },
        data: {
          status: 'failed',
          error: `[${category}] ${message}`,
          completedAt: new Date(),
        },
      })
    } else {
      // Clear the transient rendering state but keep the prior image.
      await prisma.cmfRender.update({
        where: { id: renderId },
        data: {
          status: 'ready',
          error: `[${category}] ${message}`,
        },
      })
    }

    throw err
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Approval flow
 * ────────────────────────────────────────────────────────────────────────── */

export class CmfAttemptError extends Error {
  category: 'validation' | 'forbidden'
  constructor(category: CmfAttemptError['category'], message: string) {
    super(message)
    this.category = category
    this.name = 'CmfAttemptError'
  }
}

/**
 * Approve one attempt as the canonical image for its SKU. Any previously
 * approved attempt for the same SKU drops back to "pending" — only ever
 * exactly one approved attempt per SKU.
 */
export async function approveCmfAttempt(args: {
  attemptId: string
  userId: string
}) {
  const attempt = await prisma.cmfRenderAttempt.findUnique({
    where: { id: args.attemptId },
  })
  if (!attempt) throw new CmfAttemptError('validation', 'Attempt not found')
  if (attempt.status !== 'ready') {
    throw new CmfAttemptError(
      'validation',
      'Only completed attempts can be approved.'
    )
  }

  return prisma.$transaction(async (tx) => {
    await tx.cmfRenderAttempt.updateMany({
      where: {
        renderId: attempt.renderId,
        approvalStatus: 'approved',
        id: { not: attempt.id },
      },
      data: { approvalStatus: 'pending', approvedAt: null, approvedBy: null },
    })

    const approved = await tx.cmfRenderAttempt.update({
      where: { id: attempt.id },
      data: {
        approvalStatus: 'approved',
        approvedAt: new Date(),
        approvedBy: args.userId,
        archivedAt: null,
      },
    })

    const updatedRender = await tx.cmfRender.update({
      where: { id: attempt.renderId },
      data: {
        selectedAttemptId: approved.id,
        renderUrl: approved.imageUrl ?? null,
        renderPath: approved.imagePath ?? null,
        renderWidth: approved.imageWidth ?? null,
        renderHeight: approved.imageHeight ?? null,
        status: 'ready',
      },
    })

    return { attempt: approved, render: updatedRender }
  })
}

/**
 * Archive an attempt — soft-delete that keeps the image around for history
 * but hides it from the gallery's default view. Archiving the currently
 * selected attempt also picks the next-best attempt as the new selection
 * (most-recently-ready, falling back to nothing).
 */
export async function archiveCmfAttempt(args: { attemptId: string }) {
  const attempt = await prisma.cmfRenderAttempt.findUnique({
    where: { id: args.attemptId },
  })
  if (!attempt) throw new CmfAttemptError('validation', 'Attempt not found')

  return prisma.$transaction(async (tx) => {
    const archived = await tx.cmfRenderAttempt.update({
      where: { id: attempt.id },
      data: {
        approvalStatus: 'archived',
        archivedAt: new Date(),
        approvedAt: null,
        approvedBy: null,
      },
    })

    // Re-pick the selected attempt if we just archived the canonical one.
    const render = await tx.cmfRender.findUnique({
      where: { id: attempt.renderId },
      select: { selectedAttemptId: true },
    })
    if (render?.selectedAttemptId !== attempt.id) {
      return { attempt: archived }
    }

    const fallback = await tx.cmfRenderAttempt.findFirst({
      where: {
        renderId: attempt.renderId,
        status: 'ready',
        approvalStatus: { in: ['approved', 'pending'] },
        id: { not: attempt.id },
      },
      orderBy: [
        { approvalStatus: 'asc' }, // approved comes first alphabetically
        { completedAt: 'desc' },
      ],
    })

    await tx.cmfRender.update({
      where: { id: attempt.renderId },
      data: {
        selectedAttemptId: fallback?.id ?? null,
        renderUrl: fallback?.imageUrl ?? null,
        renderPath: fallback?.imagePath ?? null,
        renderWidth: fallback?.imageWidth ?? null,
        renderHeight: fallback?.imageHeight ?? null,
      },
    })

    return { attempt: archived }
  })
}

/**
 * Restore a previously archived attempt back to "pending". Does not
 * change the SKU's selected attempt unless the SKU has no selection at all.
 */
export async function restoreCmfAttempt(args: { attemptId: string }) {
  const attempt = await prisma.cmfRenderAttempt.findUnique({
    where: { id: args.attemptId },
  })
  if (!attempt) throw new CmfAttemptError('validation', 'Attempt not found')
  if (attempt.approvalStatus !== 'archived') {
    return { attempt }
  }

  return prisma.$transaction(async (tx) => {
    const restored = await tx.cmfRenderAttempt.update({
      where: { id: attempt.id },
      data: {
        approvalStatus: 'pending',
        archivedAt: null,
      },
    })

    const render = await tx.cmfRender.findUnique({
      where: { id: attempt.renderId },
      select: { selectedAttemptId: true },
    })
    if (!render?.selectedAttemptId) {
      await tx.cmfRender.update({
        where: { id: attempt.renderId },
        data: {
          selectedAttemptId: restored.id,
          renderUrl: restored.imageUrl ?? null,
          renderPath: restored.imagePath ?? null,
          renderWidth: restored.imageWidth ?? null,
          renderHeight: restored.imageHeight ?? null,
        },
      })
    }

    return { attempt: restored }
  })
}
