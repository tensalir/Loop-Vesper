import { BaseModelAdapter, ModelConfig, GenerationRequest, GenerationResponse } from '../base'

const OPENAI_API_KEY = typeof window === 'undefined'
  ? process.env.OPENAI_API_KEY
  : null

/**
 * Aspect-ratio + resolution → OpenAI `size` string.
 * gpt-image-2 accepts any WxH where both are multiples of 16,
 * max edge 3840, ratio ≤ 3:1, total px 655 360–8 294 400.
 */
const SIZE_TABLE: Record<string, Record<number, string>> = {
  '1:1':   { 1024: '1024x1024', 2048: '2048x2048', 4096: '2880x2880' },
  '3:2':   { 1024: '1536x1024', 2048: '2048x1360', 4096: '3504x2336' },
  '2:3':   { 1024: '1024x1536', 2048: '1360x2048', 4096: '2336x3504' },
  '16:9':  { 1024: '1536x864',  2048: '2048x1152', 4096: '3840x2160' },
  '9:16':  { 1024: '864x1536',  2048: '1152x2048', 4096: '2160x3840' },
  '4:3':   { 1024: '1536x1152', 2048: '2048x1536', 4096: '3264x2448' },
  '3:4':   { 1024: '1152x1536', 2048: '1536x2048', 4096: '2448x3264' },
}

function resolveSize(aspectRatio?: string, resolution?: number): string | undefined {
  if (!aspectRatio || aspectRatio === 'auto') return 'auto'
  const byRes = SIZE_TABLE[aspectRatio]
  if (!byRes) return 'auto'
  return byRes[resolution ?? 1024] ?? byRes[1024] ?? 'auto'
}

/**
 * Convert a data-URL (data:image/png;base64,AAA…) to a Blob suitable for FormData.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL for image')
  const [, mime, b64] = match
  const bytes = Buffer.from(b64, 'base64')
  return new Blob([bytes], { type: mime })
}

export const GPT_IMAGE_2_CONFIG: ModelConfig = {
  id: 'openai-gpt-image-2',
  name: 'GPT Image 2',
  provider: 'OpenAI',
  type: 'image',
  description: 'OpenAI\'s latest image model — high quality text-to-image and editing with text rendering, up to 4K',
  supportedAspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', 'auto'],
  defaultAspectRatio: '1:1',
  maxResolution: 4096,
  capabilities: {
    'text-2-image': true,
    'image-2-image': true,
    editing: true,
    multiImageEditing: true,
    maxReferenceImages: 16,
  },
  pricing: {
    perImage: 0.053, // medium quality 1024x1024 representative
    currency: 'USD',
  },
  parameters: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: '1:1 (Square)', value: '1:1' },
        { label: '16:9 (Landscape)', value: '16:9' },
        { label: '9:16 (Portrait)', value: '9:16' },
        { label: '4:3 (Landscape)', value: '4:3' },
        { label: '3:4 (Portrait)', value: '3:4' },
        { label: '3:2 (Landscape)', value: '3:2' },
        { label: '2:3 (Portrait)', value: '2:3' },
        { label: 'Auto', value: 'auto' },
      ],
    },
    {
      name: 'resolution',
      type: 'select',
      label: 'Resolution',
      default: 1024,
      options: [
        { label: '1K', value: 1024 },
        { label: '2K', value: 2048 },
        { label: '4K', value: 4096 },
      ],
    },
    {
      name: 'numOutputs',
      type: 'select',
      label: 'Images',
      default: 1,
      options: [
        { label: '1 image', value: 1 },
        { label: '2 images', value: 2 },
        { label: '4 images', value: 4 },
      ],
    },
    {
      name: 'quality',
      type: 'select',
      label: 'Quality',
      default: 'auto',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
    },
    {
      name: 'outputFormat',
      type: 'select',
      label: 'Format',
      default: 'png',
      options: [
        { label: 'PNG', value: 'png' },
        { label: 'JPEG', value: 'jpeg' },
        { label: 'WebP', value: 'webp' },
      ],
    },
    {
      name: 'outputCompression',
      type: 'number',
      label: 'Compression',
      default: 85,
      min: 0,
      max: 100,
      step: 5,
    },
    {
      name: 'background',
      type: 'select',
      label: 'Background',
      default: 'auto',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: 'Opaque', value: 'opaque' },
      ],
    },
    {
      name: 'moderation',
      type: 'select',
      label: 'Moderation',
      default: 'auto',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: 'Low', value: 'low' },
      ],
    },
  ],
}

export class OpenAIAdapter extends BaseModelAdapter {
  private apiKey: string

  constructor(config: ModelConfig) {
    super(config)
    if (!OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is not set. Get your key from https://platform.openai.com/api-keys'
      )
    }
    this.apiKey = OPENAI_API_KEY
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    this.validateRequest(request)

    const refs = request.referenceImages || (request.referenceImage ? [request.referenceImage] : [])
    const hasRefs = refs.length > 0

    const size = resolveSize(request.aspectRatio, request.resolution)
    const quality = request.quality as string | undefined
    const outputFormat = request.outputFormat as string | undefined
    const outputCompression = request.outputCompression as number | undefined
    const background = request.background as string | undefined
    const moderation = request.moderation as string | undefined
    const n = request.numOutputs || 1
    const mask = request.mask as string | undefined

    let result: any

    if (hasRefs) {
      result = await this.callEditsEndpoint(request.prompt, refs, {
        size, quality, outputFormat, outputCompression, background, moderation, n, mask,
      })
    } else {
      result = await this.callGenerationsEndpoint(request.prompt, {
        size, quality, outputFormat, outputCompression, background, moderation, n,
      })
    }

    const outputs = (result.data || []).map((item: any) => {
      const b64 = item.b64_json
      const mimeMap: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
      const mime = mimeMap[outputFormat || 'png'] || 'image/png'
      const dataUrl = `data:${mime};base64,${b64}`

      let width = 1024
      let height = 1024
      if (size && size !== 'auto' && size.includes('x')) {
        const [w, h] = size.split('x').map(Number)
        width = w
        height = h
      }

      return { url: dataUrl, width, height }
    })

    return {
      id: `gen-${Date.now()}`,
      status: 'completed',
      outputs,
      metadata: {
        model: this.config.id,
        prompt: request.prompt,
        revisedPrompt: result.data?.[0]?.revised_prompt,
      },
      ...(result.usage && {
        metrics: {
          inputTokenCount: result.usage.input_tokens,
          outputTokenCount: result.usage.output_tokens,
        },
      }),
    }
  }

  // ------------------------------------------------------------------
  // POST /v1/images/generations  (JSON body)
  // ------------------------------------------------------------------
  private async callGenerationsEndpoint(
    prompt: string,
    opts: {
      size?: string
      quality?: string
      outputFormat?: string
      outputCompression?: number
      background?: string
      moderation?: string
      n?: number
    },
  ): Promise<any> {
    const body: Record<string, any> = {
      model: 'gpt-image-2',
      prompt,
    }
    if (opts.size) body.size = opts.size
    if (opts.quality) body.quality = opts.quality
    if (opts.outputFormat) body.output_format = opts.outputFormat
    if (opts.outputFormat && opts.outputFormat !== 'png' && opts.outputCompression != null) {
      body.output_compression = opts.outputCompression
    }
    if (opts.background) body.background = opts.background
    if (opts.moderation) body.moderation = opts.moderation
    if (opts.n && opts.n > 1) body.n = opts.n

    console.log('[OpenAI] POST /v1/images/generations', {
      size: body.size,
      quality: body.quality,
      n: body.n,
    })

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = err?.error?.message || `OpenAI API error ${res.status}`
      console.error('[OpenAI] generations error:', msg)
      throw new Error(msg)
    }

    return res.json()
  }

  // ------------------------------------------------------------------
  // POST /v1/images/edits  (multipart/form-data)
  // ------------------------------------------------------------------
  private async callEditsEndpoint(
    prompt: string,
    referenceImages: string[],
    opts: {
      size?: string
      quality?: string
      outputFormat?: string
      outputCompression?: number
      background?: string
      moderation?: string
      n?: number
      mask?: string
    },
  ): Promise<any> {
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('prompt', prompt)

    for (const img of referenceImages) {
      if (img.startsWith('data:')) {
        form.append('image[]', dataUrlToBlob(img))
      } else if (img.startsWith('http')) {
        const downloaded = await fetch(img)
        const blob = await downloaded.blob()
        form.append('image[]', blob)
      }
    }

    if (opts.mask) {
      if (opts.mask.startsWith('data:')) {
        form.append('mask', dataUrlToBlob(opts.mask))
      }
    }

    if (opts.size) form.append('size', opts.size)
    if (opts.quality) form.append('quality', opts.quality)
    if (opts.outputFormat) form.append('output_format', opts.outputFormat)
    if (opts.outputFormat && opts.outputFormat !== 'png' && opts.outputCompression != null) {
      form.append('output_compression', String(opts.outputCompression))
    }
    if (opts.background) form.append('background', opts.background)
    if (opts.moderation) form.append('moderation', opts.moderation)
    if (opts.n && opts.n > 1) form.append('n', String(opts.n))

    console.log('[OpenAI] POST /v1/images/edits', {
      imageCount: referenceImages.length,
      hasMask: Boolean(opts.mask),
      size: opts.size,
      quality: opts.quality,
    })

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: form,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = err?.error?.message || `OpenAI API error ${res.status}`
      console.error('[OpenAI] edits error:', msg)
      throw new Error(msg)
    }

    return res.json()
  }
}
