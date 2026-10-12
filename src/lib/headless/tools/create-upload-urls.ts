import { HeadlessCreateUploadUrlsSchema } from '@/lib/api/validation'
import {
  supabaseUploadIssuer,
  UPLOAD_BUCKET,
  UPLOAD_URL_TTL_SECONDS,
  uploadContentType,
  uploadPath,
  type UploadIssuer,
} from '../uploads'
import { invalidArguments, type ToolHandler } from './types'

/** `create_upload_urls`: one signed PUT URL per file, and the stored URL to pass on. Free. */
export function createUploadUrlsHandlerWith(issuer: UploadIssuer): ToolHandler {
  return {
    async run(args, ctx) {
      const parsed = HeadlessCreateUploadUrlsSchema.safeParse(args)
      if (!parsed.success) throw invalidArguments(parsed.error.issues)

      const now = new Date()
      const uploads = await Promise.all(
        parsed.data.files.map(async (file) => {
          const contentType = uploadContentType(file.name, file.contentType)
          const path = uploadPath(ctx.principal.ownerId, file.name, contentType, now)
          const issued = await issuer.issue(UPLOAD_BUCKET, path)
          return { name: file.name, contentType, uploadUrl: issued.uploadUrl, url: issued.url }
        })
      )

      const hours = UPLOAD_URL_TTL_SECONDS / 3600
      const lines = [
        `Upload each file with one PUT, the file itself as the body (within ${hours} hours), then pass its url where a Vesper tool takes an image: referenceImage and endFrameImage on generate_video, image_url on grade_image.`,
        `curl -sS -X PUT -H "Content-Type: <contentType>" --data-binary @<file> "<uploadUrl>"`,
        'A 200 answer means it is stored. Kling 3.0 takes a frame of at most 10 MB: save a larger PNG as a JPEG first, and ask for the URL with the .jpg name.',
        ...uploads.map((u) => `${u.name} (${u.contentType})\n  uploadUrl: ${u.uploadUrl}\n  url: ${u.url}`),
      ]

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { method: 'PUT', expiresInSeconds: UPLOAD_URL_TTL_SECONDS, uploads },
        costUsd: null,
      }
    },
  }
}

export const createUploadUrlsHandler = createUploadUrlsHandlerWith(supabaseUploadIssuer)
