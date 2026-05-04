import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyHeadlessRequest, recordHeadlessUsage } from '@/lib/headless/auth'
import type { HeadlessTool } from '@/lib/headless/auth'
import { MCP_TOOLS, findMcpTool } from '@/lib/headless/mcp-tools'
import { enhancePrompt } from '@/lib/prompts/enhance'
import { iteratePrompt } from '@/lib/prompts/iterate'
import { getAllModels } from '@/lib/models/registry'
import {
  HeadlessEnhanceSchema,
  HeadlessIterateSchema,
} from '@/lib/api/validation'
import { classifyError } from '@/lib/errors/classification'

/**
 * POST /api/mcp
 *
 * Streamable HTTP MCP server (JSON-RPC 2.0). Compatible with Claude's
 * MCP connector (`mcp-client-2025-11-20`), Cursor's MCP host, and any
 * other client that speaks the standard MCP protocol over HTTP.
 *
 * Authentication mirrors the REST surface: `Authorization: Bearer vsp_live_...`
 * passed as `authorization_token` from the calling MCP runtime.
 *
 * The implementation is intentionally minimal — we expose only the
 * methods Claude's connector actually exercises today (initialize,
 * tools/list, tools/call) plus standard ping/initialized notifications.
 * Resources, prompts, and sampling are explicitly out of scope until
 * there's a concrete need.
 */

export const dynamic = 'force-dynamic'

// Latest stable MCP protocol revision Anthropic's connector accepts.
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
]
const PREFERRED_PROTOCOL_VERSION = '2025-11-25'

const SERVER_INFO = {
  name: 'vesper-headless',
  version: '1.0.0',
  description:
    'Vesper headless surface: enhance prompts, build Andromeda-aware iteration slates, and discover models — all backed by the Loop Gen-AI prompting skill.',
}

// JSON-RPC 2.0 wire format
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  // MCP-specific
  toolError: -32002,
  forbidden: -32001,
} as const

function rpcSuccess(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.jsonrpc === '2.0' && typeof v.method === 'string'
}

const InitializeParamsSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.unknown()).optional(),
  clientInfo: z
    .object({
      name: z.string(),
      version: z.string().optional(),
    })
    .optional(),
})

const CallToolParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional().default({}),
})

interface AuthedPrincipal {
  credentialId: string
  ownerId: string
  allowedTools: string[]
  allowedModels: string[]
}

async function dispatch(
  rpc: JsonRpcRequest,
  principal: AuthedPrincipal,
  request: NextRequest
): Promise<JsonRpcSuccess | JsonRpcError | null> {
  const { id = null, method, params } = rpc

  // Notifications have no `id` and don't expect a response.
  const isNotification = id === null || id === undefined

  switch (method) {
    case 'initialize': {
      const parsed = InitializeParamsSchema.safeParse(params ?? {})
      if (!parsed.success) {
        return rpcError(id, ERROR_CODES.invalidParams, 'Invalid initialize params')
      }
      const requested = parsed.data.protocolVersion
      const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : PREFERRED_PROTOCOL_VERSION

      return rpcSuccess(id, {
        protocolVersion: negotiatedVersion,
        capabilities: {
          // We expose tools only — no resources, prompts, sampling, or logging
          // from this server. Adding them later is opt-in.
          tools: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions:
          'Use list_models to discover allowed Vesper models, then call enhance_prompt or iterate_prompt for the Gen-AI prompting craft. All credentials are scoped — only the tools and models on the calling token are available.',
      })
    }

    case 'notifications/initialized':
    case 'initialized':
      // No response expected.
      return null

    case 'ping':
      return rpcSuccess(id, {})

    case 'tools/list': {
      // Only expose tools the credential is allowed to call.
      const tools = MCP_TOOLS.filter((t) =>
        principal.allowedTools.includes(t.name)
      ).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
      return rpcSuccess(id, { tools })
    }

    case 'tools/call': {
      const parsed = CallToolParamsSchema.safeParse(params ?? {})
      if (!parsed.success) {
        return rpcError(id, ERROR_CODES.invalidParams, 'Invalid tools/call params')
      }
      const { name, arguments: args } = parsed.data
      const tool = findMcpTool(name)
      if (!tool) {
        return rpcError(id, ERROR_CODES.methodNotFound, `Unknown tool: ${name}`)
      }
      if (!principal.allowedTools.includes(tool.name)) {
        return rpcError(
          id,
          ERROR_CODES.forbidden,
          `This token is not permitted to call '${tool.name}'.`
        )
      }
      const startedAt = Date.now()
      try {
        const result = await runTool(tool.name, args, principal)
        recordHeadlessUsage({
          credentialId: principal.credentialId,
          ownerId: principal.ownerId,
          surface: 'mcp',
          route: '/api/mcp',
          toolName: tool.name,
          modelId: typeof args.modelId === 'string' ? args.modelId : null,
          status: 'success',
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
          metadata: { rpcMethod: 'tools/call' },
        }).catch(() => undefined)

        return rpcSuccess(id, result)
      } catch (err) {
        const e = err as { message?: string; status?: number; statusCode?: number }
        const message = e?.message || 'Tool execution failed'
        const classified = classifyError(message)
        recordHeadlessUsage({
          credentialId: principal.credentialId,
          ownerId: principal.ownerId,
          surface: 'mcp',
          route: '/api/mcp',
          toolName: tool.name,
          modelId: typeof args.modelId === 'string' ? args.modelId : null,
          status: 'error',
          httpStatus: classified.httpStatus,
          errorCategory: classified.category,
          durationMs: Date.now() - startedAt,
          metadata: { rpcMethod: 'tools/call', errorLabel: classified.label },
        }).catch(() => undefined)
        return rpcSuccess(id, {
          // MCP convention: surface tool failures as `isError: true` content
          // blocks rather than JSON-RPC errors so the calling agent can see
          // and react to the error message.
          isError: true,
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        })
      }
    }

    default:
      if (isNotification) return null
      return rpcError(
        id,
        ERROR_CODES.methodNotFound,
        `Method not found: ${method}`
      )
  }
  // request silenced lint use
  void request
}

async function runTool(
  name: HeadlessTool,
  args: Record<string, unknown>,
  principal: AuthedPrincipal
): Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown }> {
  if (name === 'list_models') {
    const all = getAllModels().map((config) => ({
      id: config.id,
      name: config.name,
      provider: config.provider,
      type: config.type,
      description: config.description,
      capabilities: config.capabilities ?? {},
      supportedAspectRatios: config.supportedAspectRatios ?? [],
      defaultAspectRatio: config.defaultAspectRatio,
      maxResolution: config.maxResolution,
    }))
    const wildcard = principal.allowedModels.includes('*')
    const visible = wildcard
      ? all
      : all.filter((m) => principal.allowedModels.includes(m.id))
    const summary = visible
      .map((m) => `- ${m.id} (${m.type}, ${m.provider}): ${m.description}`)
      .join('\n')
    return {
      content: [
        {
          type: 'text',
          text: visible.length
            ? `Available Vesper models (${visible.length}):\n${summary}`
            : 'No models are enabled for this credential. Ask an admin to grant model access.',
        },
      ],
      structuredContent: {
        models: visible,
        total: visible.length,
        wildcardAccess: wildcard,
      },
    }
  }

  if (name === 'enhance_prompt') {
    const parsed = HeadlessEnhanceSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`
      )
    }
    if (
      principal.allowedModels.length > 0 &&
      !principal.allowedModels.includes('*') &&
      !principal.allowedModels.includes(parsed.data.modelId)
    ) {
      throw new Error(
        `This token is not permitted to use model '${parsed.data.modelId}'.`
      )
    }
    const result = await enhancePrompt(parsed.data)
    return {
      content: [
        {
          type: 'text',
          text: result.enhancedPrompt,
        },
      ],
      structuredContent: {
        originalPrompt: result.originalPrompt,
        enhancedPrompt: result.enhancedPrompt,
        modelId: result.modelId,
        enhancementModel: result.enhancementModel,
        skill: result.skill,
      },
    }
  }

  if (name === 'iterate_prompt') {
    const parsed = HeadlessIterateSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`
      )
    }
    if (
      principal.allowedModels.length > 0 &&
      !principal.allowedModels.includes('*') &&
      !principal.allowedModels.includes(parsed.data.modelId)
    ) {
      throw new Error(
        `This token is not permitted to use model '${parsed.data.modelId}'.`
      )
    }
    const result = await iteratePrompt(parsed.data)
    return {
      content: [
        {
          type: 'text',
          // Stable JSON for agents that prefer text-only consumption.
          text: JSON.stringify(result.slate, null, 2),
        },
      ],
      structuredContent: {
        slate: result.slate,
        variantCount: result.variantCount,
        modelId: result.modelId,
        enhancementModel: result.enhancementModel,
        skill: result.skill,
      },
    }
  }

  // generate_asset is reserved for a future phase. Reject explicitly so
  // callers don't quietly succeed against a stub.
  throw new Error(`Tool '${name}' is not implemented yet.`)
}

/**
 * Shared MCP POST handler. Used by both `/api/mcp` (header bearer auth)
 * and `/api/mcp/[token]` (token in URL path, for Claude's custom-connector
 * form which has no auth field). Sibling routes call this directly so we
 * don't have to reconstruct the request to forward an Authorization
 * header — `verifyHeadlessRequest` accepts the path token via options.
 */
export async function handleMcpPost(
  request: NextRequest,
  options: { tokenFromPath?: string } = {}
) {
  // Cheap allowlist check for tool name happens inside the dispatcher,
  // but rate-limiting uses the same DB-backed buckets as REST.
  const verify = await verifyHeadlessRequest(request, {
    surface: 'mcp',
    tokenFromPath: options.tokenFromPath,
    // We don't require a single tool here — `tools/call` enforces per-call
    // tool allowlists via the `principal.allowedTools` list. Bearer +
    // owner-active are enough to handshake and list tools.
  })
  if (!verify.ok) return verify.response

  const principal: AuthedPrincipal = {
    credentialId: verify.principal.credential.id,
    ownerId: verify.principal.owner.id,
    allowedTools: verify.principal.credential.allowedTools,
    allowedModels: verify.principal.credential.allowedModels,
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      rpcError(null, ERROR_CODES.parseError, 'Invalid JSON body'),
      { status: 400, headers: verify.rateLimitHeaders }
    )
  }

  // Support both single requests and JSON-RPC batches.
  const isBatch = Array.isArray(body)
  const requests = (isBatch ? body : [body]) as unknown[]
  const responses: Array<JsonRpcSuccess | JsonRpcError> = []

  for (const item of requests) {
    if (!isJsonRpcRequest(item)) {
      responses.push(
        rpcError(null, ERROR_CODES.invalidRequest, 'Not a JSON-RPC 2.0 request')
      )
      continue
    }
    const out = await dispatch(item, principal, request)
    if (out) responses.push(out)
  }

  // For a single request, return the single response (not a batch). For
  // notifications-only calls, MCP servers should return 202 Accepted with
  // no body — we send an empty body and 202 to honor that.
  if (!isBatch) {
    if (responses.length === 0) {
      return new NextResponse(null, {
        status: 202,
        headers: verify.rateLimitHeaders,
      })
    }
    return NextResponse.json(responses[0], {
      headers: verify.rateLimitHeaders,
    })
  }

  return NextResponse.json(responses, {
    headers: verify.rateLimitHeaders,
  })
}

export async function POST(request: NextRequest) {
  return handleMcpPost(request)
}

// Public capability probe — no auth required. Used by some MCP discovery
// flows to confirm a server is reachable before trying authentication.
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      service: SERVER_INFO.name,
      version: SERVER_INFO.version,
      transport: 'streamable-http',
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      authentication: {
        scheme: 'Bearer',
        header: 'Authorization',
        description:
          'Send `Authorization: Bearer vsp_live_...` on every POST request.',
      },
      methods: [
        'initialize',
        'notifications/initialized',
        'ping',
        'tools/list',
        'tools/call',
      ],
      tools: MCP_TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
      })),
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    }
  )
}
