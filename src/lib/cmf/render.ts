/**
 * CMF render service.
 *
 * Given a `CmfRender` row id, this service:
 *   1. Builds the deterministic CMF recolour prompt from the row.
 *   2. Looks up the clown reference image (uploaded asset or product render).
 *   3. Asks `enhancePrompt` to polish the prompt for Nano Banana–style models.
 *   4. Calls the model adapter through the existing Vesper pattern.
 *   5. Persists the rendered image into Supabase Storage and updates the row.
 *
 * The implementation closely mirrors `src/lib/headless/generate-asset.ts` so
 * we get the same provider quirks (timeouts, base64 vs URL outputs) without
 * duplicating model adapter logic.
 */

import { prisma } from '@/lib/prisma'
import { getModel, getModelConfig } from '@/lib/models/registry'
import { enhancePrompt } from '@/lib/prompts/enhance'
import {
  downloadReferenceImageAsDataUrl,
} from '@/lib/reference-images'
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
  /**
   * The user that triggered the render. Used only for logs / future
   * attribution; does NOT scope storage paths or clown lookups (those use
   * the render's `ownerId`, i.e. the packet owner, so files stay in one
   * folder when collaborators trigger renders).
   */
  triggeredByUserId?: string
}

interface ResolvedReferences {
  /** Base64 data URLs ready for the model adapter. */
  dataUrls: string[]
  /** First reference's URL kept for prompt enhancement. */
  primaryDataUrl: string | null
}

async function resolveRowReferences(args: {
  ownerId: string
  productSlug: string
  variantSlug: string
  clownAssetId: string | null
}): Promise<ResolvedReferences> {
  const dataUrls: string[] = []

  if (args.clownAssetId) {
    const asset = await prisma.cmfClownAsset.findFirst({
      where: { id: args.clownAssetId, ownerId: args.ownerId },
    })
    if (!asset) {
      throw new CmfRenderError('reference', 'Linked clown asset is missing or not owned by the user')
    }
    const dataUrl = await downloadReferenceImageAsDataUrl(asset.imageUrl)
    dataUrls.push(dataUrl)
  } else {
    // Fallback: try to find any clown asset the user owns for this product.
    const fallback = await prisma.cmfClownAsset.findFirst({
      where: {
        ownerId: args.ownerId,
        productSlug: args.productSlug,
        variantSlug: args.variantSlug,
      },
    })
    if (fallback) {
      const dataUrl = await downloadReferenceImageAsDataUrl(fallback.imageUrl)
      dataUrls.push(dataUrl)
    }
  }

  if (dataUrls.length === 0) {
    throw new CmfRenderError(
      'reference',
      'No clown reference image is available. Upload a clown PNG for this product before rendering.'
    )
  }

  return { dataUrls, primaryDataUrl: dataUrls[0] ?? null }
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
 * Run a CMF render for a single SKU row. Updates the database row to reflect
 * progress and final state. Returns the updated render record.
 *
 * Access checks are the caller's responsibility — the route handler should
 * have already verified the user can edit this render before calling here.
 */
export async function runCmfRender({ renderId }: RenderArgs) {
  const render = await prisma.cmfRender.findUnique({
    where: { id: renderId },
  })
  if (!render) {
    throw new CmfRenderError('validation', 'Render not found')
  }
  // Always operate against the packet owner's storage path / clown library
  // so files stay namespaced consistently across collaborators.
  const ownerId = render.ownerId

  const product = getCmfProduct(render.productSlug)
  if (!product) {
    throw new CmfRenderError('validation', `Unknown product slug ${render.productSlug}`)
  }

  // Reconstruct a typed row for the prompt builder. We trust the data we
  // wrote at packet-creation time, so we don't re-validate with Zod here.
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

  const { basePrompt } = buildCmfPrompt(row)
  const modelId = ensureSupportedModel(render.modelId ?? product.defaultModelId ?? DEFAULT_MODEL_ID)

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
      ownerId,
      productSlug: render.productSlug,
      variantSlug: render.variantSlug,
      clownAssetId: render.clownAssetId,
    })

    let enhancedPrompt = basePrompt
    try {
      const enhancement = await enhancePrompt({
        prompt: basePrompt,
        modelId,
        referenceImage: refs.primaryDataUrl ?? undefined,
      })
      if (enhancement.enhancedPrompt) {
        enhancedPrompt = enhancement.enhancedPrompt
      }
    } catch (err) {
      // Prompt enhancement is opportunistic — fall back to the base prompt.
      console.warn('[cmf/render] prompt enhancement failed, using base prompt', err)
    }

    const adapter = getModel(modelId)
    if (!adapter) {
      throw new CmfRenderError('model', `Unknown model ${modelId}`)
    }

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
      throw new CmfRenderError(
        'model',
        generation.error || 'Model returned no outputs'
      )
    }

    const output = generation.outputs[0]
    const ext = output.url.includes('image/png') || output.url.endsWith('.png') ? 'png' : 'jpg'
    const path = renderStoragePath(ownerId, render.packetId, renderId, ext)
    const persistedUrl = output.url.startsWith('data:')
      ? await uploadBase64ToStorage(output.url, CMF_STORAGE_BUCKET, path)
      : await uploadUrlToStorage(output.url, CMF_STORAGE_BUCKET, path)

    const perImage = config?.pricing?.perImage ?? null

    const updated = await prisma.cmfRender.update({
      where: { id: renderId },
      data: {
        status: 'ready',
        renderUrl: persistedUrl,
        renderPath: path,
        renderWidth: output.width ?? null,
        renderHeight: output.height ?? null,
        enhancedPrompt,
        completedAt: new Date(),
        costUsd: perImage,
      },
    })

    return updated
  } catch (err) {
    const category = err instanceof CmfRenderError ? err.category : 'model'
    const message = err instanceof Error ? err.message : 'Unknown render error'
    await prisma.cmfRender.update({
      where: { id: renderId },
      data: {
        status: 'failed',
        error: `[${category}] ${message}`,
        completedAt: new Date(),
      },
    })
    throw err
  }
}
