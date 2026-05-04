/**
 * Shared shell for headless REST handlers.
 *
 * Wraps a per-route async function with:
 *  - bearer-token verification + tool/model allowlist
 *  - durable rate limiting (with `X-RateLimit-*` headers)
 *  - audit logging (always, including on failure)
 *  - error classification + safe response shape
 */

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/errors/classification'
import {
  recordHeadlessUsage,
  verifyHeadlessRequest,
  type HeadlessSurface,
  type HeadlessTool,
  type VerifyOptions,
} from './auth'

export interface HeadlessHandlerContext {
  request: NextRequest
  /** The verified principal (credential + owner). */
  principal: {
    credentialId: string
    ownerId: string
    allowedTools: string[]
    allowedModels: string[]
  }
  /** Best-effort knobs — set these before returning so the audit log
   * captures the model and tool name. */
  setModelId(modelId: string | null): void
  setMetadata(meta: Record<string, unknown>): void
  setCostUsd(cost: number | null): void
}

export interface HeadlessHandlerResult {
  /** JSON body to return. */
  body: Record<string, unknown>
  /** HTTP status (defaults to 200). */
  status?: number
  /** Extra headers (rate-limit headers are added automatically). */
  headers?: Record<string, string>
}

export interface HeadlessHandlerConfig {
  surface: HeadlessSurface
  route: string
  tool: HeadlessTool
  /** If false, body parsing is skipped. */
  parseJsonBody?: boolean
}

interface MutableContext {
  modelId: string | null
  costUsd: number | null
  metadata: Record<string, unknown>
}

/**
 * Build a Next.js route handler that delegates to `run` after enforcing
 * authentication, allowlists, and rate limits.
 */
export function withHeadlessHandler(
  config: HeadlessHandlerConfig,
  run: (
    ctx: HeadlessHandlerContext
  ) => Promise<HeadlessHandlerResult>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const startedAt = Date.now()
    const mutable: MutableContext = {
      modelId: null,
      costUsd: null,
      metadata: {},
    }

    const verifyOptions: VerifyOptions = {
      surface: config.surface,
      requireTool: config.tool,
    }

    const verify = await verifyHeadlessRequest(request, verifyOptions)
    if (!verify.ok) {
      return verify.response
    }

    const { principal, rateLimitHeaders: rlHeaders } = verify

    try {
      const ctx: HeadlessHandlerContext = {
        request,
        principal: {
          credentialId: principal.credential.id,
          ownerId: principal.owner.id,
          allowedTools: principal.credential.allowedTools,
          allowedModels: principal.credential.allowedModels,
        },
        setModelId(modelId) {
          mutable.modelId = modelId
        },
        setMetadata(meta) {
          mutable.metadata = { ...mutable.metadata, ...meta }
        },
        setCostUsd(cost) {
          mutable.costUsd = cost
        },
      }

      const result = await run(ctx)
      const status = result.status ?? 200
      const responseHeaders = {
        ...rlHeaders,
        ...(result.headers ?? {}),
      }

      // Fire-and-forget the audit log — never block on it.
      recordHeadlessUsage({
        credentialId: principal.credential.id,
        ownerId: principal.owner.id,
        surface: config.surface,
        route: config.route,
        toolName: config.tool,
        modelId: mutable.modelId,
        status: status >= 400 ? 'error' : 'success',
        httpStatus: status,
        durationMs: Date.now() - startedAt,
        costUsd: mutable.costUsd,
        metadata: Object.keys(mutable.metadata).length > 0 ? mutable.metadata : null,
      }).catch(() => undefined)

      return NextResponse.json(result.body, { status, headers: responseHeaders })
    } catch (error: unknown) {
      const err = error as { message?: string; status?: number; statusCode?: number }
      const errorMsg = err?.message || 'Headless request failed'
      const classified = classifyError(errorMsg)

      // Anthropic-specific status mapping mirrors the UI routes so callers
      // get consistent semantics whether they hit the cookie or token path.
      let httpStatus = classified.httpStatus
      let errorCategory = classified.category as string
      const upstreamStatus = err?.status || err?.statusCode

      if (upstreamStatus === 401) {
        // The user's TOKEN is fine; we couldn't reach the upstream provider.
        // Rewrite to 502 so external callers don't think their token was bad.
        httpStatus = 502
        errorCategory = 'upstream_unavailable'
      } else if (upstreamStatus === 429) {
        httpStatus = 429
        errorCategory = 'rate_limited'
      } else if (upstreamStatus === 529 || upstreamStatus === 503) {
        httpStatus = 502
        errorCategory = 'upstream_unavailable'
      }

      console.error(`[headless ${config.route}] ${classified.label}:`, errorMsg)

      recordHeadlessUsage({
        credentialId: principal.credential.id,
        ownerId: principal.owner.id,
        surface: config.surface,
        route: config.route,
        toolName: config.tool,
        modelId: mutable.modelId,
        status: 'error',
        httpStatus,
        errorCategory,
        durationMs: Date.now() - startedAt,
        costUsd: mutable.costUsd,
        metadata:
          Object.keys(mutable.metadata).length > 0
            ? { ...mutable.metadata, errorLabel: classified.label }
            : { errorLabel: classified.label },
      }).catch(() => undefined)

      return NextResponse.json(
        {
          error: errorMsg,
          errorCategory,
        },
        { status: httpStatus, headers: rlHeaders }
      )
    }
  }
}

/**
 * Convenience: read JSON body or throw a clean validation error.
 */
export async function readJsonBody<T = unknown>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    const err = new Error('Invalid JSON body') as Error & { status?: number }
    err.status = 400
    throw err
  }
}
