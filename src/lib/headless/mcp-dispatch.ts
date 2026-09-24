/**
 * The Vesper MCP server: JSON-RPC 2.0 over streamable HTTP.
 *
 * Moved out of `src/app/api/mcp/route.ts`, which is now a thin wrapper, so the
 * protocol handling can be tested and each tool lives in its own file under
 * `./tools/`. The tools a caller may list and call come from
 * `effectiveTools` in `./tool-registry.ts`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { waitUntil as vercelWaitUntil } from '@vercel/functions'
import { verifyHeadlessRequest, recordHeadlessUsage } from './auth'
import { MCP_TOOLS, findMcpTool } from './mcp-tools'
import { classifyError } from '@/lib/errors/classification'
import { McpProgressReporter } from './mcp-progress'
import { MCP_PROMPTS, findMcpPrompt, getMcpPromptMessages } from './mcp-prompts'
import { MCP_RESOURCE_CATALOG, readMcpResource } from './mcp-resources'
import { effectiveTools, type HeadlessTool } from './tool-registry'
import { TOOL_HANDLERS, type ToolContext, type ToolPrincipal } from './tools'
import { prismaJobStore } from './mcp-jobs'
import { checkDailyCostCap } from './cost-cap'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const PREFERRED_PROTOCOL_VERSION = '2025-11-25'

export const SERVER_INFO = {
  name: 'vesper-headless',
  version: '2.0.0',
  description:
    'Vesper headless surface: Gen-AI prompting, Loop product renders, image and video generation — backed by the Loop Gen-AI prompting skill.',
}

export const SERVER_INSTRUCTIONS =
  'Use list_models or the vesper://models resource to discover models; enhance_prompt / iterate_prompt for prompt craft. ' +
  'generate_asset answers inline when the draw finishes within about 50 seconds, with JPEG previews you can read and links to the full-resolution files; ' +
  'a slower draw, or one called with async: true, returns a jobId to collect with get_generation_status. ' +
  'Every draw is saved in the caller\'s Vesper project "Claude". Set allowFallback: false to forbid Replicate routing. ' +
  'A prompt filled from a Loop product skeleton is sent as it is: enhance_prompt returns it unchanged. ' +
  'list_creative_products, get_creative_kit and get_product_references read the Loop creative kit: the products, their rubrics, and the pinned references a grade or a draw attaches. ' +
  'generate_product_image draws a Loop product from its skeleton, filled by code, with the product render first and no reference parameter; ' +
  "grade_image reads a picture three times with the product's grader (judge <model> vesper x3, advisory, never pooled with your own read, which record_grade keeps apart); " +
  "record_verdict records the decider's answer and, for a Frontify asset, returns the comment line to post with the person's own Frontify connector. " +
  "Feedback on the Loop Creative plugin: list_feedback_targets, list_feedback to find the same remark, preview_feedback to show the exact issue, submit_feedback only after the colleague says yes; it is filed in the signed-in person's name."

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

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

export const ERROR_CODES = {
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

export function rpcError(
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
  clientInfo: z.object({ name: z.string(), version: z.string().optional() }).optional(),
})

const CallToolParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional().default({}),
  _meta: z.record(z.unknown()).optional(),
})

const GetPromptParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string()).optional().default({}),
})

const ReadResourceParamsSchema = z.object({ uri: z.string() })

/** What the dispatcher needs besides the request; defaults are production, tests inject. */
export interface DispatchDeps {
  handlers?: typeof TOOL_HANDLERS
  jobs?: ToolContext['jobs']
  recordUsage?: typeof recordHeadlessUsage
  checkCostCap?: typeof checkDailyCostCap
  env?: NodeJS.ProcessEnv
}

const defaultJobs: ToolContext['jobs'] = {
  store: prismaJobStore,
  waitUntil: (promise) => vercelWaitUntil(promise),
}

export async function dispatch(
  rpc: JsonRpcRequest,
  principal: ToolPrincipal,
  deps: DispatchDeps = {}
): Promise<JsonRpcResponse | null> {
  const { id = null, method, params } = rpc
  const isNotification = id === null || id === undefined
  const handlers = deps.handlers ?? TOOL_HANDLERS
  const recordUsage = deps.recordUsage ?? recordHeadlessUsage
  const env = deps.env ?? process.env

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
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    }

    case 'notifications/initialized':
    case 'initialized':
      return null

    case 'ping':
      return rpcSuccess(id, {})

    case 'tools/list': {
      const tools = MCP_TOOLS.filter((t) => principal.allowedTools.includes(t.name)).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
        ...(t.annotations ? { annotations: t.annotations } : {}),
      }))
      return rpcSuccess(id, { tools })
    }

    case 'prompts/list': {
      const prompts = MCP_PROMPTS.map((p) => ({
        name: p.name,
        title: p.title,
        description: p.description,
        ...(p.arguments ? { arguments: p.arguments } : {}),
      }))
      return rpcSuccess(id, { prompts })
    }

    case 'prompts/get': {
      const parsed = GetPromptParamsSchema.safeParse(params ?? {})
      if (!parsed.success) {
        return rpcError(id, ERROR_CODES.invalidParams, 'Invalid prompts/get params')
      }
      if (!findMcpPrompt(parsed.data.name)) {
        return rpcError(id, ERROR_CODES.methodNotFound, `Unknown prompt: ${parsed.data.name}`)
      }
      const rendered = getMcpPromptMessages(parsed.data.name, parsed.data.arguments)
      if (!rendered) {
        return rpcError(id, ERROR_CODES.internalError, 'Failed to render prompt')
      }
      return rpcSuccess(id, { description: rendered.description, messages: rendered.messages })
    }

    case 'resources/list': {
      const resources = MCP_RESOURCE_CATALOG.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }))
      return rpcSuccess(id, { resources })
    }

    case 'resources/read': {
      const parsed = ReadResourceParamsSchema.safeParse(params ?? {})
      if (!parsed.success) {
        return rpcError(id, ERROR_CODES.invalidParams, 'Invalid resources/read params')
      }
      try {
        const contents = await readMcpResource(parsed.data.uri, { allowedModels: principal.allowedModels })
        return rpcSuccess(id, contents)
      } catch (err) {
        return rpcError(id, ERROR_CODES.methodNotFound, (err as Error)?.message || 'Resource read failed')
      }
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
        return rpcError(id, ERROR_CODES.forbidden, `This token is not permitted to call '${tool.name}'.`)
      }
      const handler = handlers[tool.name as HeadlessTool]
      const modelId = typeof args.modelId === 'string' ? args.modelId : null
      const startedAt = Date.now()

      // A paid call first checks the owner's daily spend cap.
      if (handler.estimateCostUsd) {
        const decision = await (deps.checkCostCap ?? checkDailyCostCap)({
          ownerId: principal.ownerId,
          estimateUsd: handler.estimateCostUsd(args),
          env,
        })
        if (!decision.ok) {
          recordUsage({
            credentialId: principal.credentialId,
            ownerId: principal.ownerId,
            surface: 'mcp',
            route: '/api/mcp',
            toolName: tool.name,
            modelId,
            status: 'forbidden',
            httpStatus: 429,
            errorCategory: 'cost_cap',
            durationMs: Date.now() - startedAt,
            metadata: { rpcMethod: 'tools/call', capUsd: decision.capUsd, spentUsd: decision.spentUsd },
          }).catch(() => undefined)
          return rpcSuccess(id, { isError: true, content: [{ type: 'text', text: decision.message }] })
        }
      }

      const progress = new McpProgressReporter()
      progress.step('Tool accepted')
      const ctx: ToolContext = {
        principal,
        progress,
        jobs: deps.jobs ?? defaultJobs,
        env,
        recordBackgroundUsage: async (entry) => {
          await recordUsage({
            credentialId: principal.credentialId,
            ownerId: principal.ownerId,
            surface: 'mcp',
            route: '/api/mcp',
            toolName: entry.toolName,
            modelId: entry.modelId,
            status: 'success',
            httpStatus: 200,
            durationMs: entry.durationMs,
            costUsd: entry.costUsd,
            metadata: { rpcMethod: 'job', ...(entry.metadata ?? {}) },
          })
        },
      }

      try {
        const result = await handler.run(args, ctx)
        // The cost field is Vesper-internal: log it, never send it.
        const { costUsd, ...wireResult } = result
        recordUsage({
          credentialId: principal.credentialId,
          ownerId: principal.ownerId,
          surface: 'mcp',
          route: '/api/mcp',
          toolName: tool.name,
          modelId,
          status: 'success',
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
          costUsd: costUsd ?? null,
          metadata: { rpcMethod: 'tools/call' },
        }).catch(() => undefined)
        return rpcSuccess(id, wireResult)
      } catch (err) {
        const message = (err as Error)?.message || 'Tool execution failed'
        const classified = classifyError(message)
        recordUsage({
          credentialId: principal.credentialId,
          ownerId: principal.ownerId,
          surface: 'mcp',
          route: '/api/mcp',
          toolName: tool.name,
          modelId,
          status: 'error',
          httpStatus: classified.httpStatus,
          errorCategory: classified.category,
          durationMs: Date.now() - startedAt,
          metadata: { rpcMethod: 'tools/call', errorLabel: classified.label },
        }).catch(() => undefined)
        // MCP convention: a tool failure is an `isError` result the agent can read, not a JSON-RPC error.
        return rpcSuccess(id, { isError: true, content: [{ type: 'text', text: message }] })
      }
    }

    default:
      if (isNotification) return null
      return rpcError(id, ERROR_CODES.methodNotFound, `Method not found: ${method}`)
  }
}

/**
 * Shared MCP POST handler for `/api/mcp` (bearer header or a per-person
 * sign-in token) and `/api/mcp/[token]` (a static token in the URL).
 * `challenge` is set by the bare `/api/mcp` only: its 401s point the client
 * at the sign-in, the URL-token route's never do.
 */
export async function handleMcpPost(
  request: NextRequest,
  options: { tokenFromPath?: string; challenge?: boolean } = {}
): Promise<NextResponse> {
  const verify = await verifyHeadlessRequest(request, {
    surface: 'mcp',
    tokenFromPath: options.tokenFromPath,
    challenge: options.challenge ? { origin: new URL(request.url).origin } : undefined,
  })
  if (!verify.ok) return verify.response

  const principal: ToolPrincipal = {
    credentialId: verify.principal.credential.id,
    ownerId: verify.principal.owner.id,
    allowedTools: effectiveTools(verify.principal.credential, verify.principal.owner),
    allowedModels: verify.principal.credential.allowedModels,
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(rpcError(null, ERROR_CODES.parseError, 'Invalid JSON body'), {
      status: 400,
      headers: verify.rateLimitHeaders,
    })
  }

  const isBatch = Array.isArray(body)
  const requests = (isBatch ? body : [body]) as unknown[]
  const responses: JsonRpcResponse[] = []

  for (const item of requests) {
    if (!isJsonRpcRequest(item)) {
      responses.push(rpcError(null, ERROR_CODES.invalidRequest, 'Not a JSON-RPC 2.0 request'))
      continue
    }
    const out = await dispatch(item, principal)
    if (out) responses.push(out)
  }

  // Notifications only: 202 with no body, as MCP servers should.
  if (!isBatch) {
    if (responses.length === 0) {
      return new NextResponse(null, { status: 202, headers: verify.rateLimitHeaders })
    }
    return NextResponse.json(responses[0], { headers: verify.rateLimitHeaders })
  }
  return NextResponse.json(responses, { headers: verify.rateLimitHeaders })
}
