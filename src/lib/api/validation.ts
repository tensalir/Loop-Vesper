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

export const PromptEnhancementPromptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  modelIds: z.array(z.string()).optional().default([]),
  isActive: z.boolean().optional().default(true),
})
