/**
 * Gemini, called the way the Eclipse scripts call it.
 *
 * `gradeJson` mirrors `qa._call_gemini`: the kit's grader models in order;
 * strict JSON at temperature 0; code fences stripped; a 404 moves to the next
 * model; a 400 about the input image, or a rejected key, ends the read; 429,
 * 500 and 503 wait 6 s, 12 s, 18 s and try again. `drawImage` mirrors
 * `generate.gemini_image`: references in binding order, then the prompt;
 * `imageConfig` with the aspect and size, falling back once to a bare config
 * when the API rejects those names; waits of 0, 8, 16 and 24 s on 429, 500
 * and 503. Both stop at the caller's deadline.
 *
 * Parts: a pin goes by its Files API URI (`file_data`); a candidate or pin
 * of at most the kit's inline limit may go inline. Bytes are never
 * re-encoded.
 */

export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } }

export interface GeminiDeps {
  apiKey: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly terminal: boolean = false
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function inlinePart(bytes: Buffer, mimeType: string): GeminiPart {
  return { inline_data: { mime_type: mimeType, data: bytes.toString('base64') } }
}

export function filePart(uri: string, mimeType: string): GeminiPart {
  return { file_data: { mime_type: mimeType, file_uri: uri } }
}

/** A picture as a part: inline when small enough, else uploaded once through `upload`. */
export async function imagePart(
  bytes: Buffer,
  mimeType: string,
  opts: { inlineLimit: number; upload: (bytes: Buffer, mimeType: string) => Promise<string> }
): Promise<GeminiPart> {
  if (bytes.length <= opts.inlineLimit) return inlinePart(bytes, mimeType)
  return filePart(await opts.upload(bytes, mimeType), mimeType)
}

async function post(deps: GeminiDeps, model: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    return await (deps.fetchImpl ?? fetch)(`${GEMINI_API}/${model}:generateContent?key=${encodeURIComponent(deps.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function textOf(data: unknown): string {
  const candidates = ((data as { candidates?: unknown[] })?.candidates ?? []) as Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
  return candidates.flatMap((c) => c.content?.parts ?? []).map((p) => p.text ?? '').join('')
}

/**
 * One strict-JSON grading read. Returns the parsed JSON and the model that
 * answered, or throws a `GeminiError` naming the last failure.
 */
export async function gradeJson(
  deps: GeminiDeps,
  input: { models: readonly string[]; parts: GeminiPart[]; deadline: number; perCallMs: number; tries?: number }
): Promise<{ json: unknown; model: string }> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const tries = input.tries ?? 3
  const body = {
    contents: [{ parts: input.parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }
  let last = 'no model answered'
  for (const model of input.models) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const left = input.deadline - now()
      if (left <= 0) throw new GeminiError(`the read ran out of time (${last})`)
      let res: Response
      try {
        res = await post(deps, model, body, Math.min(input.perCallMs, left))
      } catch (err) {
        last = `${model} ${(err as Error)?.name === 'AbortError' ? 'timed out' : (err as Error)?.message}`
        await sleep(4000 * (attempt + 1))
        continue
      }
      if (!res.ok) {
        const msg = (await res.text().catch(() => '')).slice(0, 300)
        last = `${model} http ${res.status}: ${msg}`
        if (res.status === 400 && msg.toLowerCase().includes('input image')) {
          throw new GeminiError(`the model refused the image itself (too large, or an unsupported encoding): ${msg}`, true)
        }
        if (res.status === 401 || res.status === 403) {
          throw new GeminiError(`Vesper's GEMINI_API_KEY was rejected (${res.status})`, true)
        }
        if (res.status === 404) break // the model name is gone: the next one
        if (![429, 500, 503].includes(res.status)) break
        await sleep(6000 * (attempt + 1))
        continue
      }
      const data = await res.json().catch(() => null)
      const txt = textOf(data).trim().replace(/^```(?:json)?|```$/gm, '').trim()
      if (!txt) {
        last = `${model}: empty response`
        break
      }
      try {
        return { json: JSON.parse(txt), model }
      } catch (err) {
        last = `${model} bad json: ${(err as Error).message}`
      }
    }
  }
  throw new GeminiError(last)
}

const BACKOFFS_MS = [0, 8000, 16000, 24000]

/** One image, the references first in binding order, then the prompt. */
export async function drawImage(
  deps: GeminiDeps,
  input: { model: string; prompt: string; references: GeminiPart[]; aspect: string; size: string; deadline: number }
): Promise<{ bytes: Buffer; mimeType: string }> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const parts: GeminiPart[] = [...input.references, { text: input.prompt }]
  const configs = [
    { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: input.aspect, imageSize: input.size } },
    { responseModalities: ['IMAGE'] },
  ]
  let last = ''
  // As generate.gemini_image: any attempt that ends without an image, other than a refusal,
  // moves on to the bare config.
  for (let i = 0; i < configs.length; i++) {
    for (const backoff of BACKOFFS_MS) {
      if (backoff) {
        if (now() + backoff >= input.deadline) break
        await sleep(backoff)
      }
      const left = input.deadline - now()
      if (left <= 0) throw new GeminiError(`the draw ran out of time (${last || 'no answer'})`)
      let res: Response
      try {
        res = await post(deps, input.model, { contents: [{ parts }], generationConfig: configs[i] }, left)
      } catch (err) {
        last = (err as Error)?.message || 'network error'
        continue
      }
      if (!res.ok) {
        last = (await res.text().catch(() => '')).slice(0, 400)
        if ([429, 500, 503].includes(res.status)) continue
        if (res.status === 401 || res.status === 403) {
          throw new GeminiError(`Vesper's GEMINI_API_KEY was rejected (${res.status})`, true)
        }
        if (res.status === 400 && i === 0 && /aspect|imageconfig|imagesize/i.test(last)) break
        throw new GeminiError(`Gemini ${res.status}: ${last}`, true)
      }
      const data = (await res.json().catch(() => null)) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }>
      } | null
      for (const cand of data?.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          const blob = part.inlineData ?? part.inline_data
          const b64 = blob?.data
          if (b64) {
            const mimeType = (part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png') || 'image/png'
            return { bytes: Buffer.from(b64, 'base64'), mimeType }
          }
        }
      }
      last = 'no image in the response'
      break
    }
  }
  throw new GeminiError(`Gemini returned no image. Last: ${last}`)
}
