/**
 * MCP tool definitions for the Vesper headless surface.
 *
 * Each tool maps 1:1 to the same engine the REST API calls, so MCP
 * clients (Claude's MCP connector, Cursor, Codex, custom agents) and
 * direct REST clients always share one prompt substrate.
 *
 * The schemas here are JSON Schema (draft-07 subset) so they are wire-
 * compatible with the MCP `tools/list` response without a translation
 * layer.
 */

import type { HeadlessTool } from './auth'

export interface McpToolDefinition {
  name: HeadlessTool
  title: string
  description: string
  inputSchema: Record<string, unknown>
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'enhance_prompt',
    title: 'Enhance a generation prompt',
    description:
      'Enhance a single image or video prompt using the Vesper Gen-AI prompting skill. Returns the enhanced prompt text and the substrate version used.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'modelId'],
      properties: {
        prompt: {
          type: 'string',
          description:
            'The user-authored prompt to enhance. Plain text. The skill picks the right enhancement strategy based on `modelId` and presence of `referenceImage`.',
          minLength: 1,
          maxLength: 8000,
        },
        modelId: {
          type: 'string',
          description:
            'The Vesper model ID this prompt is targeting (e.g. `gemini-nano-banana-pro`, `openai-gpt-image-2`, `replicate-veo-3.1`). Use the `list_models` tool to discover allowed IDs.',
        },
        referenceImage: {
          type: 'string',
          description:
            'Optional data URL (`data:image/png;base64,...`) of a reference image. Triggers style-only or compositional enhancement based on the prompt language.',
        },
      },
    },
  },
  {
    name: 'iterate_prompt',
    title: 'Build an Andromeda-aware prompt slate',
    description:
      'Produce a structured slate of variant prompts that preserve declared anchors (product, offer, audience, brand, locked text) while varying 2-3 diversification axes. Returns the JSON schema described in the Iteration Slate Mode of the Gen-AI prompting skill.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'modelId'],
      properties: {
        prompt: {
          type: 'string',
          description: 'The baseline prompt or concept to iterate from.',
          minLength: 1,
          maxLength: 8000,
        },
        modelId: {
          type: 'string',
          description: 'Target Vesper model ID.',
        },
        referenceImage: {
          type: 'string',
          description:
            'Optional data URL of the baseline render. Used to ground each variant in the actual baseline composition.',
        },
        baselineOutputId: {
          type: 'string',
          description:
            'Optional UUID of an existing Vesper output the slate iterates from. Used for audit cross-references.',
        },
        anchors: {
          type: 'object',
          description:
            'Anchors that must stay constant across every variant. Empty means "infer from prompt".',
          additionalProperties: false,
          properties: {
            product: { type: 'string', maxLength: 2000 },
            offer: { type: 'string', maxLength: 2000 },
            audience: { type: 'string', maxLength: 2000 },
            brand: { type: 'string', maxLength: 2000 },
            lockedText: { type: 'string', maxLength: 2000 },
            theme: { type: 'string', maxLength: 2000 },
          },
        },
        variantCount: {
          type: 'integer',
          description: 'How many variants to return. Default 4. Range 2-8.',
          minimum: 2,
          maximum: 8,
          default: 4,
        },
        lockedAxes: {
          type: 'array',
          description:
            'Axes the caller wants to keep constant across the slate (do not vary these).',
          items: { type: 'string', maxLength: 64 },
          maxItems: 7,
        },
        preferredAxes: {
          type: 'array',
          description:
            'Axes the caller would like to see varied. The skill picks 2-3 strong axes overall.',
          items: { type: 'string', maxLength: 64 },
          maxItems: 7,
        },
      },
    },
  },
  {
    name: 'list_models',
    title: 'List available Vesper models',
    description:
      'Return the catalog of image and video models the calling credential is permitted to use. The response includes capabilities, supported aspect ratios, and the model type so callers can pick a target before calling enhance/iterate.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
]

export function findMcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}
