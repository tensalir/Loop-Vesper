/**
 * What every MCP tool handler receives and returns.
 *
 * One file per tool lives beside this one; `./index.ts` maps each tool name
 * in the registry to its handler, and a test holds the two to the same set.
 */

import type { McpContent } from '../generate-asset'
import type { McpProgressReporter } from '../mcp-progress'
import type { JobStore, WaitUntil } from '../jobs'
import type { HeadlessTool } from '../tool-registry'

export interface ToolPrincipal {
  credentialId: string
  ownerId: string
  /** Already expanded by `effectiveTools`. */
  allowedTools: HeadlessTool[]
  allowedModels: string[]
}

export interface UsageEntry {
  toolName: string
  modelId: string | null
  durationMs: number
  costUsd: number | null
  metadata?: Record<string, unknown>
}

export interface ToolContext {
  principal: ToolPrincipal
  progress: McpProgressReporter
  jobs: { store: JobStore; waitUntil: WaitUntil }
  /** Logs a finished background job's spend, which the request that started it could not. */
  recordBackgroundUsage(entry: UsageEntry): Promise<void>
  env: NodeJS.ProcessEnv
}

export interface ToolResult {
  content: McpContent[]
  structuredContent?: unknown
  /** Spend to log for this call; stripped from the wire response. */
  costUsd?: number | null
}

export interface ToolHandler {
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
  /** Preflight spend for the daily cap; absent for free tools. */
  estimateCostUsd?(args: Record<string, unknown>): number | null
}

export function invalidArguments(issues: Array<{ message: string }>): Error {
  return new Error(`Invalid arguments: ${issues.map((i) => i.message).join('; ')}`)
}

export function assertModelAllowed(allowedModels: string[], modelId: string): void {
  if (allowedModels.length > 0 && !allowedModels.includes('*') && !allowedModels.includes(modelId)) {
    throw new Error(`This token is not permitted to use model '${modelId}'.`)
  }
}
