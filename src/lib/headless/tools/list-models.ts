import { getAllModels } from '@/lib/models/registry'
import type { ToolHandler } from './types'

export const listModelsHandler: ToolHandler = {
  async run(_args, ctx) {
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
      estimatedCostUsdPerImage: config.pricing?.perImage ?? null,
    }))
    const allowedModels = ctx.principal.allowedModels
    const wildcard = allowedModels.includes('*')
    const visible = wildcard ? all : all.filter((m) => allowedModels.includes(m.id))
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
      structuredContent: { models: visible, total: visible.length, wildcardAccess: wildcard },
    }
  },
}
