/**
 * CreativeIntent — normalized intent derived from Monday brief (and optional Figma).
 * Used as input to layout-space navigation and the Sigil Skill.
 */

export interface CreativeIntent {
  /** Primary CTA copy (e.g. "Shop Now", "Learn More"). */
  cta: string
  /** Offer or value prop (e.g. "20% off"). */
  offer?: string
  /** Target audience or campaign segment. */
  targetAudience?: string
  /** Channel (e.g. instagram_feed, instagram_story, meta, tiktok). */
  channel: string
  /** Language code (e.g. en, de). */
  language: string
  /** Campaign objective (e.g. awareness, conversion, traffic). */
  campaignObjective?: string
  /** Headline (if from brief). */
  headline?: string
  /** Body/supporting copy (if from brief). */
  body?: string
  /** Legal or disclaimer text (if required). */
  legalText?: string
  /** Format preference (e.g. 4x5, 9x16). */
  formatId: string
  /** Tone hint (e.g. playful, professional). */
  tone?: string
  /** Source Monday item id (for traceability). */
  mondayItemId?: string
  /** Link to Figma brief (if available). */
  figmaBriefUrl?: string
}

/**
 * Maps Monday board columns to CreativeIntent.
 * Standardized "Sigil Brief" board template column names.
 */
export interface MondayBriefRow {
  itemId: string
  name?: string
  /** Column id or title -> value. */
  columnValues: Record<string, string | number | null>
}

/** Default column name mapping (can be overridden per board). */
export const DEFAULT_MONDAY_COLUMN_MAP: Record<keyof CreativeIntent, string> = {
  cta: 'cta',
  offer: 'offer',
  targetAudience: 'target_audience',
  channel: 'channel',
  language: 'language',
  campaignObjective: 'campaign_objective',
  headline: 'headline',
  body: 'body',
  legalText: 'legal_text',
  formatId: 'format',
  tone: 'tone',
  mondayItemId: 'id',
  figmaBriefUrl: 'link_to_brief',
}

/**
 * Map a Monday item row to CreativeIntent.
 * Column keys are normalized to lowercase with underscores.
 */
export function mondayRowToCreativeIntent(
  row: MondayBriefRow,
  columnMap: Partial<Record<keyof CreativeIntent, string>> = {}
): CreativeIntent {
  const map = { ...DEFAULT_MONDAY_COLUMN_MAP, ...columnMap }
  const get = (key: keyof CreativeIntent): string => {
    const col = map[key]
    const raw = col ? row.columnValues[col] : undefined
    return raw != null ? String(raw).trim() : ''
  }
  const cta = get('cta') || 'Shop Now'
  const channel = get('channel') || 'instagram_feed'
  const language = get('language') || 'en'
  const formatId = get('formatId') || '4x5'
  return {
    cta,
    offer: get('offer') || undefined,
    targetAudience: get('targetAudience') || undefined,
    channel,
    language,
    campaignObjective: get('campaignObjective') || undefined,
    headline: get('headline') || undefined,
    body: get('body') || undefined,
    legalText: get('legalText') || undefined,
    formatId,
    tone: get('tone') || undefined,
    mondayItemId: row.itemId,
    figmaBriefUrl: get('figmaBriefUrl') || undefined,
  }
}
