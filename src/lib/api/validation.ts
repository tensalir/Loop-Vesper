import { z } from 'zod'
import { NextResponse } from 'next/server'

/**
 * Validate a request body against a Zod schema.
 * Returns the parsed data or a NextResponse error.
 */
export async function validateBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<
  | { data: z.infer<T>; error: null }
  | { data: null; error: NextResponse }
> {
  try {
    const body = await request.json()
    const result = schema.safeParse(body)
    if (!result.success) {
      return {
        data: null,
        error: NextResponse.json(
          {
            error: 'Invalid request body',
            details: result.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          { status: 400 }
        ),
      }
    }
    return { data: result.data, error: null }
  } catch {
    return {
      data: null,
      error: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      ),
    }
  }
}

// ─── Shared Schemas ───────────────────────────────────────────

export const GenerateRequestSchema = z.object({
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
  modelId: z.string().min(1, 'modelId is required'),
  prompt: z.string().min(1, 'prompt is required').max(50000),
  negativePrompt: z.string().optional(),
  parameters: z.record(z.unknown()).optional().default({}),
})

export const DismissGenerationSchema = z.object({
  status: z.literal('dismissed'),
})

export const UpdateOutputSchema = z.object({
  isStarred: z.boolean().optional(),
  isApproved: z.boolean().optional(),
})

export const UpdateSessionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isPrivate: z.boolean().optional(),
})

export const UpdateProfileSchema = z.object({
  displayName: z.string().max(255).optional(),
  username: z.string().max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
})

export const PromptEnhanceSchema = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  modelId: z.string().min(1, 'modelId is required'),
  referenceImage: z.string().optional(),
})

// Iteration / Andromeda-aware variant slate request.
// Unlike enhancement, this returns a structured JSON slate, not a single prompt.
export const PromptIterateSchema = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  modelId: z.string().min(1, 'modelId is required'),
  referenceImage: z.string().optional(),
  // Optional baseline output id when iterating from an existing generation.
  baselineOutputId: z.string().uuid().optional(),
  // Anchors that must remain constant across every variant.
  anchors: z
    .object({
      product: z.string().max(2000).optional(),
      offer: z.string().max(2000).optional(),
      audience: z.string().max(2000).optional(),
      brand: z.string().max(2000).optional(),
      lockedText: z.string().max(2000).optional(),
      theme: z.string().max(2000).optional(),
    })
    .optional(),
  // Number of variants to generate (3–6 honors the diversification matrix recipes).
  variantCount: z.number().int().min(2).max(8).optional().default(4),
  // Axes the user explicitly wants to lock (do not vary). Optional.
  lockedAxes: z.array(z.string().min(1)).max(7).optional(),
  // Axes the user explicitly wants to vary (preferred). Optional.
  preferredAxes: z.array(z.string().min(1)).max(7).optional(),
})

export const PromptEnhancementPromptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  modelIds: z.array(z.string()).optional().default([]),
  isActive: z.boolean().optional().default(true),
})

// ─── Headless API Schemas ─────────────────────────────────────
//
// These schemas are stricter than the cookie-auth UI schemas because
// they're hit by untrusted external callers. We cap prompt length and
// reference-image payload size to keep memory, log volume, and Anthropic
// token usage bounded.

const HEADLESS_PROMPT_MAX = 8_000
// 6 MB of base64 -> ~4.5 MB of binary, well below Vercel's 4.5 MB body
// limit when the field is a data URL. Values larger than this should be
// uploaded out-of-band first.
const HEADLESS_REFERENCE_IMAGE_MAX = 6 * 1024 * 1024

export const HeadlessEnhanceSchema = z.object({
  prompt: z.string().min(1, 'prompt is required').max(HEADLESS_PROMPT_MAX),
  modelId: z.string().min(1, 'modelId is required').max(128),
  referenceImage: z
    .string()
    .max(HEADLESS_REFERENCE_IMAGE_MAX, 'referenceImage exceeds 6 MB cap')
    .optional(),
})

export const HeadlessIterateSchema = z.object({
  prompt: z.string().min(1, 'prompt is required').max(HEADLESS_PROMPT_MAX),
  modelId: z.string().min(1, 'modelId is required').max(128),
  referenceImage: z
    .string()
    .max(HEADLESS_REFERENCE_IMAGE_MAX, 'referenceImage exceeds 6 MB cap')
    .optional(),
  baselineOutputId: z.string().uuid().optional(),
  anchors: z
    .object({
      product: z.string().max(2000).optional(),
      offer: z.string().max(2000).optional(),
      audience: z.string().max(2000).optional(),
      brand: z.string().max(2000).optional(),
      lockedText: z.string().max(2000).optional(),
      theme: z.string().max(2000).optional(),
    })
    .optional(),
  variantCount: z.number().int().min(2).max(8).optional().default(4),
  lockedAxes: z.array(z.string().min(1).max(64)).max(7).optional(),
  preferredAxes: z.array(z.string().min(1).max(64)).max(7).optional(),
})
