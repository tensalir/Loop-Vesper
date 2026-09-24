import { HeadlessListProductRendersSchema } from '@/lib/api/validation'
import { listProductRenders } from '../list-product-renders'
import { invalidArguments, type ToolHandler } from './types'

export const listProductRendersHandler: ToolHandler = {
  async run(args) {
    const parsed = HeadlessListProductRendersSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const renders = await listProductRenders(parsed.data)
    const previewLines = renders
      .slice(0, 25)
      .map((r) => {
        const parts = [r.name]
        if (r.colorway) parts.push(r.colorway)
        if (r.renderType) parts.push(`(${r.renderType})`)
        if (r.angle) parts.push(`angle: ${r.angle}`)
        return `- ${r.id}  ${parts.join(' / ')}`
      })
      .join('\n')
    const overflow = renders.length > 25 ? `\n…and ${renders.length - 25} more.` : ''
    const text = renders.length
      ? `${renders.length} product render${renders.length === 1 ? '' : 's'} available:\n${previewLines}${overflow}\n\nPass any id back as productRenderIds in generate_asset to use it as a reference image.`
      : 'No product renders match those filters. Try removing the filters or call list_product_renders with no arguments to see the full catalog.'
    return {
      content: [{ type: 'text', text }],
      structuredContent: { renders, total: renders.length },
    }
  },
}
