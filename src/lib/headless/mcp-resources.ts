/**
 * MCP `resources/list` + `resources/read` for Vesper.
 * URI scheme: vesper://product-renders, vesper://models, vesper://skill/genai-prompting,
 * vesper://creative/kit, vesper://creative/products, vesper://creative/products/<slug>/rubric
 */

import { getAllModels } from '@/lib/models/registry'
import { listProductRenders } from './list-product-renders'
import { getGenAiSkillResourceText } from './mcp-prompts'
import { githubAppConfigFromEnv } from '@/lib/github/app'

export interface McpResourceDefinition {
  uri: string
  name: string
  description: string
  mimeType: string
}

export const MCP_RESOURCE_CATALOG: McpResourceDefinition[] = [
  {
    uri: 'vesper://product-renders',
    name: 'Loop product renders',
    description:
      'Catalog of Switch, Engage, Quiet, Experience, Dream, Eclipse, Aphrodite and other Loop product renders. Use ids in generate_asset.productRenderIds.',
    mimeType: 'application/json',
  },
  {
    uri: 'vesper://models',
    name: 'Vesper model catalog',
    description:
      'Image and video models with capabilities, aspect ratios, parameters, and pricing hints.',
    mimeType: 'application/json',
  },
  {
    uri: 'vesper://skill/genai-prompting',
    name: 'Gen-AI prompting skill',
    description:
      "The prompting skill enhance_prompt runs on: the Loop edition from the creative kit when Vesper can read it, else the bundled skill.",
    mimeType: 'text/markdown',
  },
  {
    uri: 'vesper://creative/kit',
    name: 'Loop creative kit',
    description: "The kit Vesper runs on: version, tag, commit, whether it is stale, and its products.",
    mimeType: 'application/json',
  },
  {
    uri: 'vesper://creative/products',
    name: 'Loop products Vesper serves',
    description:
      'Each product in the creative kit that Vesper serves, with its rubric version and who decides. Each rubric is at vesper://creative/products/<slug>/rubric.',
    mimeType: 'application/json',
  },
]

const RUBRIC_URI = /^vesper:\/\/creative\/products\/([a-z0-9-]+)\/rubric$/

export async function readMcpResource(
  uri: string,
  principal: { allowedModels: string[] }
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  if (uri === 'vesper://product-renders') {
    const renders = await listProductRenders({})
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ renders, total: renders.length }, null, 2),
        },
      ],
    }
  }

  if (uri === 'vesper://models') {
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
      parameters: config.parameters ?? [],
      pricing: config.pricing ?? null,
    }))
    const wildcard = principal.allowedModels.includes('*')
    const visible = wildcard
      ? all
      : all.filter((m) => principal.allowedModels.includes(m.id))
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ models: visible, total: visible.length }, null, 2),
        },
      ],
    }
  }

  if (uri === 'vesper://skill/genai-prompting') {
    const fromKit = await kitPromptingText()
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: fromKit ?? getGenAiSkillResourceText(),
        },
      ],
    }
  }

  if (uri === 'vesper://creative/kit' || uri === 'vesper://creative/products' || RUBRIC_URI.test(uri)) {
    const { getCreativeKit } = await import('@/lib/creative/kit-runtime')
    const { kitHeader, kitSection, listProducts, rubricMarkdown } = await import('@/lib/creative/tool-views')
    const { resolveProduct } = await import('@/lib/creative/products')
    const loaded = await getCreativeKit()
    if (uri === 'vesper://creative/kit') {
      const { structured } = kitSection(loaded, 'summary', () => true)
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(structured, null, 2) }] }
    }
    if (uri === 'vesper://creative/products') {
      const products = listProducts(loaded.kit, () => true)
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ...kitHeader(loaded), products }, null, 2) }],
      }
    }
    const slug = RUBRIC_URI.exec(uri)![1]
    const { product } = resolveProduct(loaded.kit, slug)
    return { contents: [{ uri, mimeType: 'text/markdown', text: rubricMarkdown(slug, product) }] }
  }

  throw new Error(`Unknown resource URI: ${uri}`)
}

/** The Loop edition's body from the kit, or null (no App, no kit, or a failure: the bundled skill is served). */
async function kitPromptingText(): Promise<string | null> {
  if (!githubAppConfigFromEnv()) return null
  try {
    const { loadKitPrompting } = await import('@/lib/creative/kit-runtime')
    return (await loadKitPrompting())?.text ?? null
  } catch {
    return null
  }
}
