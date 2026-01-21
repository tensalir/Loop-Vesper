import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Use service role key for server-side storage operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

// Long-lived cache control for immutable assets (paths include timestamps)
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable' // 1 year

/**
 * Upload base64 data URL to Supabase Storage
 * @param base64DataUrl - Data URL format: data:image/png;base64,iVBORw0...
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @param opts - Optional settings (cacheControl)
 * @returns Public URL of uploaded file
 */
export async function uploadBase64ToStorage(
  base64DataUrl: string,
  bucket: string,
  path: string,
  opts?: { cacheControl?: string }
): Promise<string> {
  try {
    // Extract base64 data and mime type
    // NOTE: Avoid regex here. Very large data URLs can cause RegExp engines to blow the stack.
    if (typeof base64DataUrl !== 'string' || !base64DataUrl.startsWith('data:')) {
      throw new Error('Invalid base64 data URL format')
    }

    const commaIndex = base64DataUrl.indexOf(',')
    if (commaIndex === -1) {
      throw new Error('Invalid base64 data URL format')
    }

    const meta = base64DataUrl.slice('data:'.length, commaIndex) // e.g. "image/png;base64" or "image/jpeg;charset=utf-8;base64"
    const base64Data = base64DataUrl.slice(commaIndex + 1)

    const parts = meta.split(';').filter(Boolean)
    const mimeType = parts[0] || 'application/octet-stream'
    const isBase64 = parts.includes('base64')
    if (!isBase64) {
      throw new Error('Invalid base64 data URL format')
    }
    
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64')

    // Upload to Supabase Storage
    // Use upsert: true to handle existing files gracefully (e.g., retries, duplicate uploads)
    // Use cacheControl for long-lived immutable assets (paths typically include timestamps)
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: true, // Allow overwriting existing files
        cacheControl: opts?.cacheControl || IMMUTABLE_CACHE_CONTROL,
      })

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`)
    }

    // Get public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(path)

    return publicUrlData.publicUrl
  } catch (error: unknown) {
    console.error('Error uploading to storage:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to upload to storage: ${message}`)
  }
}

/**
 * Upload external URL to Supabase Storage
 * @param url - External URL to download and upload (supports http://, https://, and gs://)
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @param opts - Optional settings (headers for fetch, cacheControl for storage)
 * @returns Public URL of uploaded file
 */
export async function uploadUrlToStorage(
  url: string,
  bucket: string,
  path: string,
  opts?: { headers?: Record<string, string>; cacheControl?: string }
): Promise<string> {
  try {
    let response: Response
    
    // Handle GCS URIs (gs://bucket-name/path/to/file)
    if (url.startsWith('gs://')) {
      // Convert GCS URI to HTTP URL
      // Format: gs://bucket-name/path/to/file -> https://storage.googleapis.com/bucket-name/path/to/file
      const gsPath = url.replace('gs://', '')
      const [bucketName, ...pathParts] = gsPath.split('/')
      const filePath = pathParts.join('/')
      
      // Fetch from Google Cloud Storage
      response = await fetch(`https://storage.googleapis.com/${bucketName}/${filePath}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch from GCS: ${response.statusText}`)
      }
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      // Regular HTTP/HTTPS URL
      response = await fetch(url, {
        headers: {
          ...(opts?.headers || {}),
        },
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch from URL: ${response.statusText}`)
      }
    } else {
      throw new Error(`Unsupported URL format: ${url}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Detect content type from URL or response headers
    let contentType = response.headers.get('content-type')
    if (!contentType) {
      // Fallback: detect from file extension
      const ext = url.split('.').pop()?.toLowerCase()
      if (ext === 'mp4' || ext === 'webm') {
        contentType = 'video/mp4'
      } else if (ext === 'jpg' || ext === 'jpeg') {
        contentType = 'image/jpeg'
      } else if (ext === 'png') {
        contentType = 'image/png'
      } else {
        contentType = 'application/octet-stream'
      }
    }

    // Upload to Supabase Storage
    // Use upsert: true to handle existing files gracefully (e.g., retries, duplicate uploads)
    // Use cacheControl for long-lived immutable assets (paths typically include timestamps)
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true, // Allow overwriting existing files
        cacheControl: opts?.cacheControl || IMMUTABLE_CACHE_CONTROL,
      })

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`)
    }

    // Get public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(path)

    return publicUrlData.publicUrl
  } catch (error: unknown) {
    console.error('Error uploading URL to storage:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to upload URL to storage: ${message}`)
  }
}

/**
 * Delete file from Supabase Storage
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 */
export async function deleteFromStorage(
  bucket: string,
  path: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.storage.from(bucket).remove([path])

    if (error) {
      throw new Error(`Storage deletion failed: ${error.message}`)
    }
  } catch (error: unknown) {
    console.error('Error deleting from storage:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to delete from storage: ${message}`)
  }
}

