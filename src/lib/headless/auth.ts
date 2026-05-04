/**
 * Bearer-token authentication for the headless Vesper surface.
 *
 * Used by both the REST API (`/api/headless/v1/*`) and the MCP endpoint
 * (`/api/mcp`). This is intentionally separate from `lib/api/auth.ts`
 * (Supabase cookies) and from the worker `INTERNAL_API_SECRET` path —
 * external machine credentials live in their own table with their own
 * scoping and revocation primitives so a leak in one surface cannot
 * cascade into trusted internal paths.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { HeadlessCredential, Profile } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  extractBearerToken,
  hashHeadlessToken,
} from './tokens'
import {
  checkAndIncrementHeadlessRate,
  rateLimitHeaders,
  type CredentialLimits,
} from './rate-limit'

export type HeadlessSurface = 'rest' | 'mcp'

export type HeadlessTool =
  | 'enhance_prompt'
  | 'iterate_prompt'
  | 'list_models'
  | 'generate_asset'

export interface HeadlessPrincipal {
  credential: HeadlessCredential
  owner: Pick<Profile, 'id' | 'role' | 'pausedAt' | 'deletedAt'>
}

export interface VerifyOptions {
  /** Require this tool to be present in the credential's allowlist. */
  requireTool?: HeadlessTool
  /** Optionally require this model to be present in the credential's allowlist. */
  requireModel?: string
  /** Surface label for audit logging. */
  surface: HeadlessSurface
  /** Skip the durable rate-limit increment (useful for cheap discovery routes). */
  skipRateLimit?: boolean
}

export interface VerifyFailure {
  ok: false
  response: NextResponse
}

export interface VerifySuccess {
  ok: true
  principal: HeadlessPrincipal
  rateLimit: {
    minute: { count: number; limit: number; resetSeconds: number }
    day: { count: number; limit: number; resetSeconds: number }
  }
  rateLimitHeaders: Record<string, string>
}

export type VerifyResult = VerifySuccess | VerifyFailure

function deny(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): VerifyFailure {
  return {
    ok: false,
    response: NextResponse.json(body, {
      status,
      headers,
    }),
  }
}

/**
 * Verify the `Authorization` header on an incoming request, look up the
 * credential, enforce tool/model allowlists, and atomically check the
 * durable rate-limit buckets. Returns either an opaque failure response
 * the caller can return directly, or a `principal` describing the owner
 * profile and the credential record.
 */
export async function verifyHeadlessRequest(
  request: NextRequest | Request,
  options: VerifyOptions
): Promise<VerifyResult> {
  const headerValue = request.headers.get('authorization')
  const rawToken = extractBearerToken(headerValue)
  if (!rawToken) {
    return deny(401, {
      error: 'Missing or malformed Vesper API token. Provide `Authorization: Bearer vsp_live_...`.',
      errorCategory: 'auth',
    })
  }

  const tokenHash = hashHeadlessToken(rawToken)
  const credential = await prisma.headlessCredential.findUnique({
    where: { tokenHash },
    include: {
      owner: {
        select: {
          id: true,
          role: true,
          pausedAt: true,
          deletedAt: true,
        },
      },
    },
  })

  if (!credential) {
    return deny(401, {
      error: 'Invalid Vesper API token.',
      errorCategory: 'auth',
    })
  }

  if (credential.revokedAt) {
    return deny(401, {
      error: 'This Vesper API token has been revoked.',
      errorCategory: 'auth',
    })
  }

  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
    return deny(401, {
      error: 'This Vesper API token has expired.',
      errorCategory: 'auth',
    })
  }

  if (credential.owner.deletedAt) {
    return deny(403, {
      error: 'The owner of this token has been deleted.',
      errorCategory: 'auth',
    })
  }

  if (credential.owner.pausedAt) {
    return deny(403, {
      error: 'The owner of this token is paused.',
      errorCategory: 'auth',
    })
  }

  if (options.requireTool && !credential.allowedTools.includes(options.requireTool)) {
    return deny(403, {
      error: `This token is not permitted to call '${options.requireTool}'.`,
      errorCategory: 'auth',
    })
  }

  if (options.requireModel && credential.allowedModels.length > 0) {
    if (!credential.allowedModels.includes(options.requireModel)) {
      return deny(403, {
        error: `This token is not permitted to use model '${options.requireModel}'.`,
        errorCategory: 'auth',
      })
    }
  }

  const limits: CredentialLimits = {
    rateLimitPerMinute: credential.rateLimitPerMinute,
    rateLimitPerDay: credential.rateLimitPerDay,
  }

  if (!options.skipRateLimit) {
    const decision = await checkAndIncrementHeadlessRate(credential.id, limits)
    const headers = rateLimitHeaders(decision)
    if (!decision.allowed) {
      return deny(
        429,
        {
          error: 'Rate limit exceeded for this Vesper API token.',
          errorCategory: 'rate_limited',
          retryAfterSeconds: Number(headers['Retry-After']) || decision.minute.resetSeconds,
        },
        headers
      )
    }

    // Best-effort: bump `lastUsedAt` so operators can spot stale tokens.
    // Don't await — failure here must not block the request.
    prisma.headlessCredential
      .update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) => {
        // Swallow: lastUsedAt is metadata, not critical path.
        console.warn('[headless-auth] Failed to update lastUsedAt', err?.message)
      })

    return {
      ok: true,
      principal: { credential, owner: credential.owner },
      rateLimit: {
        minute: {
          count: decision.minute.count,
          limit: decision.minute.limit,
          resetSeconds: decision.minute.resetSeconds,
        },
        day: {
          count: decision.day.count,
          limit: decision.day.limit,
          resetSeconds: decision.day.resetSeconds,
        },
      },
      rateLimitHeaders: headers,
    }
  }

  return {
    ok: true,
    principal: { credential, owner: credential.owner },
    rateLimit: {
      minute: { count: 0, limit: credential.rateLimitPerMinute ?? 0, resetSeconds: 60 },
      day: { count: 0, limit: credential.rateLimitPerDay ?? 0, resetSeconds: 86_400 },
    },
    rateLimitHeaders: {},
  }
}

/**
 * Best-effort audit log entry. Always called from a `finally` block so
 * the request itself is never blocked by logging failures.
 */
export async function recordHeadlessUsage(input: {
  credentialId: string
  ownerId: string
  surface: HeadlessSurface
  route: string
  toolName?: string | null
  modelId?: string | null
  status: 'success' | 'error' | 'rate_limited' | 'forbidden'
  httpStatus: number
  errorCategory?: string | null
  durationMs: number
  costUsd?: number | null
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await prisma.headlessUsageLog.create({
      data: {
        credentialId: input.credentialId,
        ownerId: input.ownerId,
        surface: input.surface,
        route: input.route,
        toolName: input.toolName ?? null,
        modelId: input.modelId ?? null,
        status: input.status,
        httpStatus: input.httpStatus,
        errorCategory: input.errorCategory ?? null,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        costUsd: input.costUsd ?? null,
        metadata: (input.metadata as never) ?? null,
      },
    })
  } catch (err) {
    console.warn('[headless-auth] Failed to write usage log', (err as Error)?.message)
  }
}
