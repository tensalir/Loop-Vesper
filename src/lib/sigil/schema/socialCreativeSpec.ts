/**
 * SocialCreativeSpec — platform dimensions, safe zones, and creative constraints.
 * Versioned per platform (e.g. Instagram safe zones change yearly).
 */

export const SOCIAL_CREATIVE_SPEC_VERSION = '1.0.0'

/** Safe zone: no text or CTAs in these regions (pixels from edge). */
export interface SafeZoneSpec {
  topPx: number
  bottomPx: number
  leftPx: number
  rightPx: number
  /** Usable width for text (px). */
  usableWidthPx: number
  /** Usable height for text (px). */
  usableHeightPx: number
  note?: string
}

/** Platform asset format. */
export interface PlatformFormatSpec {
  id: string
  name: string
  aspectRatio: string
  widthPx: number
  heightPx: number
  safeZone: SafeZoneSpec
  /** Images/backgrounds can extend into safe zones; only text/CTA must stay inside. */
  backgroundCanExtendIntoSafeZone: boolean
  /** Main content margin (px) for general layout. */
  mainMarginPx?: number
  specVersion: string
}

/** Known platform formats (Loop Performance Safe Zone template). */
export const PLATFORM_FORMATS: Record<string, PlatformFormatSpec> = {
  '4x5': {
    id: '4x5',
    name: 'Feed 4:5',
    aspectRatio: '4:5',
    widthPx: 1440,
    heightPx: 1800,
    safeZone: {
      topPx: 180,
      bottomPx: 180,
      leftPx: 80,
      rightPx: 80,
      usableWidthPx: 1440 - 160,
      usableHeightPx: 1440,
      note: 'No text or CTAs in top/bottom 180px. Central 1:1 (1440x1440) usable.',
    },
    backgroundCanExtendIntoSafeZone: true,
    mainMarginPx: 80,
    specVersion: SOCIAL_CREATIVE_SPEC_VERSION,
  },
  '9x16': {
    id: '9x16',
    name: 'Story 9:16',
    aspectRatio: '9:16',
    widthPx: 1440,
    heightPx: 2560,
    safeZone: {
      topPx: 240,
      bottomPx: 492,
      leftPx: 80,
      rightPx: 80,
      usableWidthPx: 1440,
      usableHeightPx: 1828,
      note: 'No text or CTAs in top 240px, bottom 492px. Usable 1440x1828.',
    },
    backgroundCanExtendIntoSafeZone: true,
    mainMarginPx: 80,
    specVersion: SOCIAL_CREATIVE_SPEC_VERSION,
  },
  '1:1': {
    id: '1:1',
    name: 'Square 1:1',
    aspectRatio: '1:1',
    widthPx: 1080,
    heightPx: 1080,
    safeZone: {
      topPx: 80,
      bottomPx: 80,
      leftPx: 80,
      rightPx: 80,
      usableWidthPx: 920,
      usableHeightPx: 920,
      note: 'Generic safe margins.',
    },
    backgroundCanExtendIntoSafeZone: true,
    mainMarginPx: 80,
    specVersion: SOCIAL_CREATIVE_SPEC_VERSION,
  },
}

/** CTA constraints (e.g. minimum size, placement). */
export interface CTAConstraintSpec {
  minHeightPx?: number
  minWidthPx?: number
  /** Must lie entirely within safe zone. */
  mustBeInSafeZone: boolean
}

/** Legal text constraints. */
export interface LegalTextConstraintSpec {
  minFontSizePx: number
  minContrastRatio: number
  /** Must not be in exclusion zones (e.g. bottom 10% for some platforms). */
  exclusionZones?: Array<{ topPx: number; bottomPx: number; leftPx: number; rightPx: number }>
}

/** Full creative spec for a given platform/format. */
export interface SocialCreativeSpec {
  version: string
  platformFormat: PlatformFormatSpec
  ctaConstraint: CTAConstraintSpec
  legalTextConstraint: LegalTextConstraintSpec
  /** Language-specific: e.g. German ~1.3x character budget for same space. */
  languageScaleFactors?: Record<string, number>
}

export function getSocialCreativeSpec(formatId: string): SocialCreativeSpec | null {
  const platformFormat = PLATFORM_FORMATS[formatId]
  if (!platformFormat) return null
  return {
    version: SOCIAL_CREATIVE_SPEC_VERSION,
    platformFormat,
    ctaConstraint: {
      mustBeInSafeZone: true,
      minHeightPx: 44,
      minWidthPx: 120,
    },
    legalTextConstraint: {
      minFontSizePx: 10,
      minContrastRatio: 4.5,
    },
    languageScaleFactors: {
      en: 1,
      de: 1.3,
      fr: 1.15,
      es: 1.1,
    },
  }
}
