import { HeadlessListProductRendersSchema } from '@/lib/api/validation'
import { searchProductRenders, type ProductRenderForMcp } from '../list-product-renders'
import { describeQuery, type RenderQuery } from '@/lib/product-renders/query'
import { invalidArguments, type ToolHandler } from './types'

export const listProductRendersHandler: ToolHandler = {
  async run(args) {
    const parsed = HeadlessListProductRendersSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const { renders, read, widened } = await searchProductRenders(parsed.data)
    const text = listingText(renders, parsed.data.name, read, widened)
    return {
      content: [{ type: 'text', text }],
      structuredContent: { renders, total: renders.length, ...(read?.recognised ? { read } : {}) },
    }
  },
}

/** Every render when there are few enough to read (one product's whole set), else the first 25. */
export const LISTING_ALL_UP_TO = 60

export function listingText(
  renders: ProductRenderForMcp[],
  phrase: string | undefined,
  read: RenderQuery | null,
  widened: boolean
): string {
  const how = phrase && read ? describeQuery(phrase, read) : null
  const head = [
    how,
    widened ? 'Nothing matched the colourway or kind of picture asked for, so here is the whole product.' : null,
  ]
    .filter(Boolean)
    .join(' ')
  if (!renders.length) {
    return (head ? head + '\n' : '')
      + 'No product renders match those filters. Try removing the filters or call list_product_renders with no arguments to see the full catalog.'
  }
  const shown = renders.length <= LISTING_ALL_UP_TO ? renders : renders.slice(0, 25)
  const lines = shown
    .map((r) => {
      const parts = [r.name]
      if (r.colorway) parts.push(r.colorway)
      if (r.renderType) parts.push(`(${r.renderType})`)
      if (r.angle) parts.push(`angle: ${r.angle}`)
      return `- ${r.id}  ${parts.join(' / ')}`
    })
    .join('\n')
  const overflow = renders.length > shown.length
    ? `\n…and ${renders.length - shown.length} more. Name a product, a colourway or a kind of picture (renderType) to see them all.`
    : ''
  return `${head ? head + '\n' : ''}${renders.length} product render${renders.length === 1 ? '' : 's'} available:\n${lines}${overflow}\n\nPass any id back as productRenderIds in generate_asset to use it as a reference image.`
}
