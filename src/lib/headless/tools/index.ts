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
import { generateProductImageHandler } from './creative-draw'
import { gradeImageHandler, recordGradeHandler } from './creative-grade'
import { recordVerdictHandler } from './creative-verdict'
import { exportCreativeRecordsHandler } from './creative-export'
import { listFeedbackTargetsHandler, listFeedbackHandler, previewFeedbackHandler, submitFeedbackHandler } from './feedback'
import { cmfListHandler, cmfPromptHandler, cmfRenderHandler, cmfCheckPdfHandler } from './cmf'

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
  generate_product_image: generateProductImageHandler,
  grade_image: gradeImageHandler,
  record_grade: recordGradeHandler,
  record_verdict: recordVerdictHandler,
  export_creative_records: exportCreativeRecordsHandler,
  list_feedback_targets: listFeedbackTargetsHandler,
  list_feedback: listFeedbackHandler,
  preview_feedback: previewFeedbackHandler,
  submit_feedback: submitFeedbackHandler,
  cmf_list: cmfListHandler,
  cmf_prompt: cmfPromptHandler,
  cmf_render: cmfRenderHandler,
  cmf_check_pdf: cmfCheckPdfHandler,
}

export type { ToolContext, ToolHandler, ToolResult, ToolPrincipal, UsageEntry } from './types'
