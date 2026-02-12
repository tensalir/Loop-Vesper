/**
 * Monday.com API client for Sigil brief extraction.
 * Uses REST/GraphQL API v2 with API token. Fetches board items and maps to CreativeIntent.
 */

import type { CreativeIntent, MondayBriefRow } from '@/lib/sigil/schema/creativeIntent'
import { mondayRowToCreativeIntent } from '@/lib/sigil/schema/creativeIntent'

const MONDAY_API_URL = 'https://api.monday.com/v2'

export interface MondayColumnValue {
  id: string
  title?: string
  text?: string
  value?: string
  type?: string
}

export interface MondayItem {
  id: string
  name: string
  column_values?: MondayColumnValue[]
}

export interface MondayBoardItemsResponse {
  data?: {
    boards?: Array<{
      id: string
      name: string
      items_page?: {
        cursor?: string
        items?: MondayItem[]
      }
    }>
  }
  errors?: Array<{ message: string }>
}

function getMondayToken(): string {
  const token = process.env.MONDAY_API_TOKEN
  if (!token) throw new Error('MONDAY_API_TOKEN is not set')
  return token
}

/**
 * Run a GraphQL query against Monday.com API v2.
 */
export async function mondayGraphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = getMondayToken()
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Monday API error: ${res.status} ${res.statusText}`)
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) throw new Error(`Monday API: ${json.errors.map((e) => e.message).join('; ')}`)
  return json.data as T
}

/**
 * Fetch items from a board (first page). Column values are returned as JSON strings; we parse and flatten.
 */
export async function fetchBoardItems(
  boardId: string | number,
  limit = 100
): Promise<MondayItem[]> {
  const data = await fetchBoardItemsPage(String(boardId), limit, null)
  return data.items
}

export interface BoardItemsPageResult {
  items: MondayItem[]
  cursor: string | null
}

/**
 * Fetch one page of board items. Pass cursor from previous page for next page (use null for first page).
 */
export async function fetchBoardItemsPage(
  boardId: string,
  limit: number,
  cursor: string | null
): Promise<BoardItemsPageResult> {
  if (cursor) {
    const query = `
      query ($limit: Int!, $cursor: String!) {
        next_items_page(limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
            column_values {
              id
              title
              text
              value
              type
            }
          }
        }
      }
    `
    const data = await mondayGraphql<{ next_items_page?: { cursor?: string; items?: MondayItem[] } }>(
      query,
      { limit, cursor }
    )
    const page = data?.next_items_page
    return {
      items: page?.items ?? [],
      cursor: page?.cursor ?? null,
    }
  }
  const query = `
    query ($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        id
        name
        items_page(limit: $limit) {
          cursor
          items {
            id
            name
            column_values {
              id
              title
              text
              value
              type
            }
          }
        }
      }
    }
  `
  const data = await mondayGraphql<MondayBoardItemsResponse['data']>(query, {
    boardId,
    limit,
  })
  const board = data?.boards?.[0]
  const items = board?.items_page?.items ?? []
  const nextCursor = board?.items_page?.cursor ?? null
  return { items, cursor: nextCursor }
}

/**
 * Fetch all items from a board using cursor pagination (active items; archived require known IDs per Monday API).
 */
export async function fetchAllBoardItems(
  boardId: string | number,
  options?: { pageSize?: number; maxItems?: number }
): Promise<MondayItem[]> {
  const pageSize = options?.pageSize ?? 100
  const maxItems = options?.maxItems ?? 10_000
  const collected: MondayItem[] = []
  let cursor: string | null = null
  const boardIdStr = String(boardId)
  while (collected.length < maxItems) {
    const { items, cursor: nextCursor } = await fetchBoardItemsPage(
      boardIdStr,
      pageSize,
      cursor
    )
    collected.push(...items)
    if (!nextCursor || items.length === 0) break
    cursor = nextCursor
  }
  return collected.slice(0, maxItems)
}

/**
 * Convert Monday item column_values to a flat columnValues map (title -> text or parsed value).
 */
function itemToColumnValues(item: MondayItem): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const col of item.column_values ?? []) {
    const key = col.title ? col.title.toLowerCase().replace(/\s+/g, '_') : col.id
    if (col.text != null) out[key] = col.text
    else if (col.value != null) {
      try {
        const parsed = JSON.parse(col.value)
        if (typeof parsed === 'object' && parsed !== null && 'text' in parsed) out[key] = parsed.text
        else if (typeof parsed === 'string') out[key] = parsed
        else if (typeof parsed === 'number') out[key] = parsed
        else out[key] = col.value
      } catch {
        out[key] = col.value
      }
    }
  }
  return out
}

/**
 * Fetch board items and map each to CreativeIntent (Sigil brief).
 */
export async function fetchBriefsFromBoard(
  boardId: string | number,
  options?: { limit?: number; columnMap?: Partial<Record<keyof CreativeIntent, string>> }
): Promise<CreativeIntent[]> {
  const items = await fetchBoardItems(boardId, options?.limit ?? 100)
  const rows: MondayBriefRow[] = items.map((item) => ({
    itemId: item.id,
    name: item.name,
    columnValues: itemToColumnValues(item),
  }))
  return rows.map((row) => mondayRowToCreativeIntent(row, options?.columnMap))
}

/**
 * Fetch a single item by id (for webhook enrichment). Fetches one page and finds by itemId.
 */
export async function getMondayItem(
  boardId: string | number,
  itemId: string
): Promise<MondayItem | null> {
  const items = await fetchBoardItems(boardId, 50)
  return items.find((i) => i.id === itemId) ?? null
}

/**
 * Create an update (post) on a Monday item. Used to mirror Figma feedback into Monday.
 */
export async function createItemUpdate(itemId: string, body: string): Promise<{ id?: string }> {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update (item_id: $itemId, body: $body) {
        id
      }
    }
  `
  const data = await mondayGraphql<{ create_update?: { id: string } }>(query, {
    itemId,
    body,
  })
  return { id: data?.create_update?.id }
}
