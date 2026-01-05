/**
 * Frontify API Client
 * 
 * Integrates with Frontify's GraphQL API to fetch product assets.
 * Falls back gracefully when credentials are not configured.
 * 
 * Environment variables:
 * - FRONTIFY_API_TOKEN: API access token from Frontify
 * - FRONTIFY_PROJECT_ID: The project/library ID to fetch assets from
 * 
 * API Documentation: https://developer.frontify.com/
 */

export interface FrontifyAsset {
  id: string
  title: string
  description?: string
  previewUrl: string
  downloadUrl: string
  tags: string[]
  createdAt: string
  modifiedAt: string
}

export interface ProductRenderFromFrontify {
  id: string
  name: string
  colorway: string | null
  imageUrl: string
  source: 'frontify'
  frontifyId: string
}

const FRONTIFY_API_URL = 'https://api.frontify.com/graphql'

/**
 * Check if Frontify integration is configured
 */
export function isFrontifyConfigured(): boolean {
  return !!(process.env.FRONTIFY_API_TOKEN && process.env.FRONTIFY_PROJECT_ID)
}

/**
 * Fetch assets from Frontify using GraphQL API
 * 
 * @param options - Search and filter options
 * @returns Array of assets transformed to ProductRender format
 */
export async function fetchFrontifyAssets(options?: {
  search?: string
  tags?: string[]
  limit?: number
}): Promise<ProductRenderFromFrontify[]> {
  if (!isFrontifyConfigured()) {
    console.log('[Frontify] Not configured, skipping fetch')
    return []
  }

  const token = process.env.FRONTIFY_API_TOKEN!
  const projectId = process.env.FRONTIFY_PROJECT_ID!
  const limit = options?.limit || 100

  // GraphQL query to fetch assets from a library
  const query = `
    query GetLibraryAssets($projectId: ID!, $first: Int!, $search: String) {
      library(id: $projectId) {
        assets(first: $first, search: $search) {
          edges {
            node {
              id
              title
              description
              previewUrl(width: 800, height: 800)
              downloadUrl
              tags {
                value
              }
              createdAt
              modifiedAt
            }
          }
        }
      }
    }
  `

  try {
    const response = await fetch(FRONTIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          projectId,
          first: limit,
          search: options?.search || null,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Frontify API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (data.errors) {
      console.error('[Frontify] GraphQL errors:', data.errors)
      throw new Error(`Frontify GraphQL error: ${data.errors[0]?.message}`)
    }

    const assets = data.data?.library?.assets?.edges || []

    // Transform to ProductRender format
    return assets.map((edge: any) => {
      const asset = edge.node
      const tags = asset.tags?.map((t: any) => t.value) || []
      
      // Try to extract colorway from tags or title
      const colorwayTag = tags.find((t: string) => 
        t.toLowerCase().includes('color') || 
        t.toLowerCase().includes('colour')
      )
      
      return {
        id: asset.id,
        name: asset.title || 'Untitled',
        colorway: colorwayTag || null,
        imageUrl: asset.previewUrl || asset.downloadUrl,
        source: 'frontify' as const,
        frontifyId: asset.id,
      }
    })
  } catch (error) {
    console.error('[Frontify] Failed to fetch assets:', error)
    return []
  }
}

/**
 * Sync a single Frontify asset to local database
 * Returns the data needed to create/update a ProductRender record
 */
export async function getFrontifyAssetDetails(assetId: string): Promise<ProductRenderFromFrontify | null> {
  if (!isFrontifyConfigured()) {
    return null
  }

  const token = process.env.FRONTIFY_API_TOKEN!

  const query = `
    query GetAsset($id: ID!) {
      asset(id: $id) {
        id
        title
        description
        previewUrl(width: 1200, height: 1200)
        downloadUrl
        tags {
          value
        }
      }
    }
  `

  try {
    const response = await fetch(FRONTIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: { id: assetId },
      }),
    })

    if (!response.ok) {
      throw new Error(`Frontify API error: ${response.status}`)
    }

    const data = await response.json()
    const asset = data.data?.asset

    if (!asset) {
      return null
    }

    const tags = asset.tags?.map((t: any) => t.value) || []
    const colorwayTag = tags.find((t: string) => 
      t.toLowerCase().includes('color') || 
      t.toLowerCase().includes('colour')
    )

    return {
      id: asset.id,
      name: asset.title || 'Untitled',
      colorway: colorwayTag || null,
      imageUrl: asset.previewUrl || asset.downloadUrl,
      source: 'frontify',
      frontifyId: asset.id,
    }
  } catch (error) {
    console.error('[Frontify] Failed to fetch asset details:', error)
    return null
  }
}

