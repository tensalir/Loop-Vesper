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
  } | null
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
      },
    }
  }

  throw new CmfRenderError(
    'reference',
    'No clown reference image is available. Upload a clown PNG for this product before rendering.'
  )
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
export async function runCmfRender({ renderId, triggeredByUserId }: RenderArgs) {
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

  // Allocate the next attempt number — monotonic per SKU so attempt 1 stays
  // attempt 1 even after archiving / restoring.
  const lastAttempt = await prisma.cmfRenderAttempt.findFirst({
    where: { renderId },
    orderBy: { attemptNumber: 'desc' },
    select: { attemptNumber: true },
  })
  const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1

  // Each attempt explores a different lighting/mood variant so a bulk
  // burst produces a real fan of options. Variant 0 (Studio Classic) is
  // Damien's gold-standard; subsequent attempts cycle through Warm,
  // Clinical, Dramatic, then loop back.
  const { basePrompt, variant } = buildCmfPrompt(row, {
    variantIndex: attemptNumber - 1,
  })

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
    const supportsMulti = !!config?.capabilities?.multiImageEditing

    const generation = await Promise.race([
      adapter.generate({
        prompt: enhancedPrompt,
        numOutputs: 1,
        ...(refs.dataUrls.length > 1 && supportsMulti
          ? { referenceImages: refs.dataUrls }
          : refs.dataUrls.length >= 1
          ? { referenceImage: refs.dataUrls[0] }
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
