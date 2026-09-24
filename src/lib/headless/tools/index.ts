/**
 * Tool name → handler. Every tool in the registry has exactly one handler;
 * `tests/headless-registry.spec.ts` holds the two lists to the same set.
 */

import type { HeadlessTool } from '../tool-registry'
import type { ToolHandler } from './types'
import { enhancePromptHandler } from './enhance-prompt'
import { iteratePromptHandler } from './iterate-prompt'
import { listModelsHandler } from './list-models'
import { generateAssetHandler } from './generate-asset'
import { listProductRendersHandler } from './list-product-renders'
import { getGenerationStatusHandler } from './get-generation-status'
import { generateVideoHandler } from './generate-video'
import { estimateGenerationCostHandler } from './estimate-generation-cost'
import { getCreativeKitHandler, listCreativeProductsHandler, getProductReferencesHandler } from './creative-read'

export const TOOL_HANDLERS: Record<HeadlessTool, ToolHandler> = {
  enhance_prompt: enhancePromptHandler,
  iterate_prompt: iteratePromptHandler,
  list_models: listModelsHandler,
  generate_asset: generateAssetHandler,
  list_product_renders: listProductRendersHandler,
  get_generation_status: getGenerationStatusHandler,
  generate_video: generateVideoHandler,
  estimate_generation_cost: estimateGenerationCostHandler,
  get_creative_kit: getCreativeKitHandler,
  list_creative_products: listCreativeProductsHandler,
  get_product_references: getProductReferencesHandler,
}

export type { ToolContext, ToolHandler, ToolResult, ToolPrincipal, UsageEntry } from './types'
