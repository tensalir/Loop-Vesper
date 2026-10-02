/**
 * MCP `resources/list` + `resources/read` for Vesper.
 * URI scheme: vesper://product-renders, vesper://models, vesper://skill/genai-prompting,
 * vesper://creative/kit, vesper://creative/products, vesper://creative/products/<slug>/rubric
 */

import { getAllModels } from '@/lib/models/registry'
import { listProductRenders } from './list-product-renders'
import { getGenAiSkillResourceText } from './mcp-prompts'

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
      'Catalog of Switch, Engage, Quiet, Experience, Dream, Eclipse, Live Pro (codename Aphrodite) and other Loop product renders and photographs (packaging, in-ear). Use ids in generate_asset.productRenderIds.',
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
    name: 'Loop prompting skill',
    description:
      'The Loop edition of the prompting skill from the creative kit, with its version: what enhance_prompt and iterate_prompt run on, and what to write a generate_asset or generate_video prompt with. When the kit cannot be read, its first line says so and names what is served instead.',
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
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: await getGenAiSkillResourceText(),
        },
      ],
    }
  }

  if (uri === 'vesper://creative/kit' || uri === 'vesper://creative/products' || RUBRIC_URI.test(uri)) {
    const { productionKitSet } = await import('@/lib/creative/kit-runtime')
    const { loadKitSet, resolveInKits } = await import('@/lib/creative/kit-set')
    const { kitHeader, kitSection, listProducts, rubricMarkdown } = await import('@/lib/creative/tool-views')
    if (RUBRIC_URI.test(uri)) {
      // CMF's rubric is the product kit's; every other product's the creative kit's.
      const hit = await resolveInKits(productionKitSet(), RUBRIC_URI.exec(uri)![1])
      return { contents: [{ uri, mimeType: 'text/markdown', text: rubricMarkdown(hit.slug, hit.product) }] }
    }
    const set = await loadKitSet(productionKitSet())
    const loaded = set.studio ?? set.product!
    const productKit = set.product ? kitHeader(set.product) : null
    if (uri === 'vesper://creative/kit') {
      const { structured } = kitSection(loaded, 'summary', () => true)
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ...structured, product_kit: productKit }, null, 2) }] }
    }
    const products = [
      ...(set.studio ? listProducts(set.studio.kit, () => true) : []),
      ...(set.product ? listProducts(set.product.kit, () => true) : []),
    ]
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ...kitHeader(loaded), product_kit: productKit, products }, null, 2) }],
    }
  }

  throw new Error(`Unknown resource URI: ${uri}`)
}
