/**
 * Canonical Loop product catalog used by the CMF flow.
 *
 * Two responsibilities:
 *  1. Stable component vocabulary per product so prompts and PDFs can speak in
 *     human terms ("POM ring", "Cosmetic cap") rather than hex regions.
 *  2. Workbook tab → product slug mapping so the transposed CMF schema
 *     (one tab per product, one column per SKU) can resolve to the right
 *     product without a designer touching code.
 *
 * Why a static manifest:
 *  - Component vocabulary is brand/product domain knowledge, not user data.
 *    Hard-coding it lets us validate workbook columns and prompt structure
 *    at parse time instead of trusting freeform strings.
 *  - New products land via a code change + a new clown PNG, both of which we
 *    want code review to gate.
 *
 * Component regions are intentionally generous: prompts that mention a region
 * the workbook didn't fill simply fall back to "keep as in the reference",
 * which is the same posture the recolour skill encodes. Regions therefore
 * describe the *recolourable surface set* of the product, not a mandatory
 * checklist.
 */

export interface CmfProductComponent {
  /** Stable region key matched in workbook columns and clown component maps. */
  region: string
  /** Display label shown in the UI and embedded in prompts. */
  label: string
  /** Optional default material when the workbook leaves it blank. */
  defaultMaterial?: string
  /** Optional default finish when the workbook leaves it blank. */
  defaultFinish?: string
}

export interface CmfProductSpec {
  slug: string
  /** Display name that appears in UI and PDF. */
  name: string
  /** "earplug" | "case" — used to decide PDF section ordering. */
  category: 'earplug' | 'case' | 'sensewear'
  /**
   * Workbook tab aliases. The transposed parser uses these to map a sheet
   * name like "Switch 2" or "Switch 2 CC" to the right product slug. All
   * comparisons are case- and whitespace-insensitive.
   */
  sheetAliases: string[]
  components: CmfProductComponent[]
  /** Default Vesper image model for this product's recolour pass. */
  defaultModelId: string
  /** Short prompt fragment describing the product so the model gets framing right. */
  promptDescriptor: string
  /**
   * Slug of the "parent" product this entry belongs to. Used to nest
   * carry cases / pouches as a subsection under their corresponding
   * earplug or sensewear product in the CMF Studio dropdown — a case
   * always belongs to a product, never the other way around.
   *
   * Convention: `case-<product>` and `pouch-<product>` slugs declare
   * `parentSlug: '<product>'`. Top-level products (and the generic
   * `case` slug retained for legacy data) leave this undefined.
   */
  parentSlug?: string
}

const NANO_BANANA_PRO = 'gemini-nano-banana-pro'

export const CMF_PRODUCT_CATALOG: CmfProductSpec[] = [
  // ─── Earplugs ─────────────────────────────────────────────────────────────
  {
    slug: 'switch2',
    name: 'Loop Switch 2',
    category: 'earplug',
    sheetAliases: ['Switch 2', 'Switch2'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Switch 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM', defaultFinish: 'Matte' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'ABS', defaultFinish: 'NCVM Satin' },
      { region: 'nozzle_piece', label: 'Nozzle piece + retention ring', defaultMaterial: 'ABS', defaultFinish: 'VDI 21 Matte' },
      { region: 'eartip', label: 'Eartip (hidden flange)', defaultMaterial: 'Silicone', defaultFinish: 'Milky see-through 30%' },
      { region: 'artwork', label: 'Artwork', defaultFinish: 'Pad printing' },
    ],
  },
  {
    slug: 'engage2',
    name: 'Loop Engage 2',
    category: 'earplug',
    sheetAliases: ['Engage 2', 'Engage2'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Engage 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'body_left', label: 'Body — Left', defaultMaterial: 'ABS' },
      { region: 'body_right', label: 'Body — Right', defaultMaterial: 'ABS' },
      { region: 'eartip_left', label: 'Eartip — Left', defaultMaterial: 'Silicone' },
      { region: 'eartip_right', label: 'Eartip — Right', defaultMaterial: 'Silicone' },
    ],
  },
  {
    slug: 'experience2',
    name: 'Loop Experience 2',
    category: 'earplug',
    sheetAliases: ['Experience 2', 'Experience2'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Experience 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'body_left', label: 'Body — Left', defaultMaterial: 'ABS', defaultFinish: 'NCVM high glossy' },
      { region: 'body_right', label: 'Body — Right', defaultMaterial: 'ABS', defaultFinish: 'NCVM high glossy' },
      { region: 'eartip_left', label: 'Eartip — Left', defaultMaterial: 'Silicone (Shore 50)', defaultFinish: 'Grinded matte' },
      { region: 'eartip_right', label: 'Eartip — Right', defaultMaterial: 'Silicone (Shore 50)', defaultFinish: 'Grinded matte' },
    ],
  },
  {
    slug: 'quiet2',
    name: 'Loop Quiet 2',
    category: 'earplug',
    sheetAliases: ['Quiet 2', 'Quiet2', 'Quiet 2.0'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Quiet 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'body_left', label: 'Body — Left', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'body_right', label: 'Body — Right', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'tip_left', label: 'Tip — Left', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'tip_right', label: 'Tip — Right', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'aphrodite',
    name: 'Loop Aphrodite',
    category: 'earplug',
    sheetAliases: ['Aphrodite Earplug', 'Aphrodite'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Aphrodite earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'top_housing', label: 'A. Top housing', defaultMaterial: 'PC/ABS' },
      { region: 'bottom_housing', label: 'B. Bottom housing', defaultMaterial: 'PC/ABS' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'jewel_accent', label: 'Jewel accent', defaultMaterial: 'PC' },
    ],
  },
  {
    slug: 'dream',
    name: 'Loop Dream',
    category: 'earplug',
    sheetAliases: ['Dream', 'P051_Dream'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Dream earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'body_outer', label: 'Body — Outer', defaultMaterial: 'Silicone (Shore 30)', defaultFinish: 'VDI 18' },
      { region: 'body_stem', label: 'Body — Stem', defaultMaterial: 'Silicone (Shore 90)', defaultFinish: 'VDI 24' },
      { region: 'tip_sleeve', label: 'Tip — Sleeve', defaultMaterial: 'Silicone (Shore 50)', defaultFinish: 'Grinded' },
      { region: 'tip_core', label: 'Tip — Core', defaultMaterial: 'PU Foam' },
    ],
  },
  {
    slug: 'link',
    name: 'Loop Link',
    category: 'earplug',
    sheetAliases: ['Link'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Link earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'cocoon',
    name: 'Loop Cocoon',
    category: 'sensewear',
    sheetAliases: ['Cocoon', 'Baby earmuffs'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Cocoon baby earmuffs, studio-lit hero render, neutral background',
    components: [
      { region: 'ear_cushion', label: 'Ear cushion', defaultMaterial: 'Fabric (microfiber)' },
      { region: 'foam', label: 'Foam', defaultMaterial: 'PU foam' },
      { region: 'earcup', label: 'Earcup (right + left)', defaultMaterial: 'ABS', defaultFinish: 'VDI 21 Matte' },
      { region: 'front_strap', label: 'Front strap', defaultMaterial: 'Elastic knit fabric' },
      { region: 'velcro_front', label: 'Velcro front', defaultMaterial: 'PA velcro' },
      { region: 'pouch', label: 'Pouch', defaultMaterial: 'Polyester velour' },
    ],
  },
  {
    slug: 'eclipse',
    name: 'Loop Eclipse',
    category: 'sensewear',
    sheetAliases: ['Eclipse'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Eclipse sleep mask, studio-lit hero render, neutral background',
    components: [
      { region: 'strap_exterior', label: 'Strap exterior', defaultMaterial: '85% PA / 15% EL (130 GSM)' },
      { region: 'strap_interior', label: 'Strap interior', defaultMaterial: '85% PA / 15% EL (130 GSM)' },
      { region: 'o_logo', label: '"O" Logo', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'wordmark_logo', label: 'Wordmark logo', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'eyecup_exterior', label: 'Eyecup exterior', defaultMaterial: '85% PA / 15% EL (130 GSM)' },
      { region: 'eyecup_interior', label: 'Eyecup interior', defaultMaterial: '85% PA / 15% EL (130 GSM)' },
      { region: 'anti_slip', label: 'Anti-slip feature', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  // ─── Carry cases ──────────────────────────────────────────────────────────
  // Generic case retained as a backward-compatible slug; product-specific
  // case slugs follow the `case-<product>` convention.
  {
    slug: 'case',
    name: 'Loop Carry Case',
    category: 'case',
    sheetAliases: [],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop carry case for earplugs, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell', label: 'Outer shell', defaultMaterial: 'PC/ABS' },
      { region: 'lid', label: 'Lid', defaultMaterial: 'PC/ABS' },
      { region: 'tray', label: 'Inner tray', defaultMaterial: 'TPU' },
      { region: 'lanyard', label: 'Lanyard', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'case-switch2',
    name: 'Loop Switch 2 Carry Case',
    category: 'case',
    parentSlug: 'switch2',
    sheetAliases: ['Switch 2 CC', 'Switch 2 Carry Case'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Switch 2 carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell_front', label: 'Shell — Front', defaultMaterial: 'ABS', defaultFinish: 'VDI 24' },
      { region: 'shell_back', label: 'Shell — Back', defaultMaterial: 'ABS', defaultFinish: 'VDI 24' },
      { region: 'insert', label: 'Insert', defaultMaterial: 'Silicone', defaultFinish: 'VDI 24' },
      { region: 'cord', label: 'Cord', defaultMaterial: 'TPE', defaultFinish: 'Matte' },
      { region: 'artwork', label: 'Artwork' },
    ],
  },
  {
    slug: 'case-engage2',
    name: 'Loop Engage 2 Carry Case',
    category: 'case',
    parentSlug: 'engage2',
    sheetAliases: ['Engage 2 CC', 'Engage 2 Carry Case'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Engage 2 carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell_front', label: 'Shell — Front', defaultMaterial: 'ABS' },
      { region: 'shell_back', label: 'Shell — Back', defaultMaterial: 'ABS' },
      { region: 'insert', label: 'Insert', defaultMaterial: 'Silicone' },
      { region: 'cord', label: 'Cord', defaultMaterial: 'TPE' },
    ],
  },
  {
    slug: 'case-experience2',
    name: 'Loop Experience 2 Carry Case',
    category: 'case',
    parentSlug: 'experience2',
    sheetAliases: ['Experience 2 CC', 'Experience 2 Carry Case'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Experience 2 carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell_front', label: 'Shell — Front', defaultMaterial: 'ABS' },
      { region: 'shell_back', label: 'Shell — Back', defaultMaterial: 'ABS' },
      { region: 'insert', label: 'Insert', defaultMaterial: 'Silicone' },
      { region: 'cord', label: 'Cord', defaultMaterial: 'TPE' },
    ],
  },
  {
    slug: 'case-quiet2',
    name: 'Loop Quiet 2 Carry Case',
    category: 'case',
    parentSlug: 'quiet2',
    sheetAliases: ['Quiet 2 CC', 'Quiet 2 Carry Case'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Quiet 2 carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell_front', label: 'Shell — Front', defaultMaterial: 'ABS' },
      { region: 'shell_back', label: 'Shell — Back', defaultMaterial: 'ABS' },
      { region: 'insert', label: 'Insert', defaultMaterial: 'Silicone' },
      { region: 'cord', label: 'Cord', defaultMaterial: 'TPE' },
    ],
  },
  {
    slug: 'case-dream',
    name: 'Loop Dream Carry Case',
    category: 'case',
    parentSlug: 'dream',
    sheetAliases: ['Dream CC', 'Dream Carry Case'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Dream carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell_front', label: 'CC Shell — Front', defaultMaterial: 'PC/ABS' },
      { region: 'shell_back', label: 'CC Shell — Back', defaultMaterial: 'PC/ABS' },
      { region: 'tray', label: 'Inner tray', defaultMaterial: 'TPU' },
      { region: 'lanyard', label: 'Lanyard', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'case-aphrodite',
    name: 'Loop Aphrodite Carry Case',
    category: 'case',
    parentSlug: 'aphrodite',
    sheetAliases: ['Aphrodite CC', 'Aphrodite Carry Case'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Aphrodite carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'case_lid_housing', label: '1. Case lid housing', defaultMaterial: 'PC or PC/ABS', defaultFinish: 'High-gloss mirror polish' },
      { region: 'inner_lid_housing', label: '2. Inner lid housing', defaultMaterial: 'ABS or PC/ABS', defaultFinish: 'VDI 24' },
      { region: 'hinge', label: '3. Hinge', defaultMaterial: 'MIM SUS304', defaultFinish: 'VDI 24 + PVD' },
      { region: 'lower_housing', label: '4. Lower housing', defaultMaterial: 'PC 1008', defaultFinish: 'VDI 24' },
      { region: 'cradle_housing', label: '5. Cradle housing', defaultMaterial: 'PC 1008', defaultFinish: 'VDI 24' },
      { region: 'button', label: '7. Button', defaultMaterial: 'PC 1008', defaultFinish: 'VDI 24' },
      { region: 'battery_bracket', label: '10. Battery bracket', defaultMaterial: 'PC/ABS', defaultFinish: 'VDI 24 / High-gloss' },
      { region: 'inner_lower_housing', label: '11. Inner lower housing', defaultMaterial: 'PC/ABS', defaultFinish: 'VDI 24' },
    ],
  },
  {
    slug: 'pouch-link',
    name: 'Loop Link Pouch',
    category: 'case',
    parentSlug: 'link',
    sheetAliases: ['Link Pouch'],
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a soft pouch carrier for Loop Link earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pouch_body', label: 'Pouch body', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
]

const PRODUCT_BY_SLUG = new Map(CMF_PRODUCT_CATALOG.map((p) => [p.slug, p]))

const PRODUCT_BY_SHEET = (() => {
  const map = new Map<string, CmfProductSpec>()
  for (const product of CMF_PRODUCT_CATALOG) {
    for (const alias of product.sheetAliases) {
      map.set(normaliseSheetKey(alias), product)
    }
    // Self-alias on display name and slug too — designers occasionally rename
    // tabs to the product's marketing name or its slug.
    map.set(normaliseSheetKey(product.name), product)
    map.set(normaliseSheetKey(product.slug), product)
  }
  return map
})()

function normaliseSheetKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function getCmfProduct(slug: string): CmfProductSpec | null {
  return PRODUCT_BY_SLUG.get(slug.toLowerCase()) ?? null
}

/**
 * Resolve a workbook sheet name to its CMF product. Tolerant of casing,
 * whitespace, dashes and minor punctuation differences ("Switch 2 CC",
 * "Switch2CC", "switch 2 cc" all match).
 */
export function getCmfProductBySheet(sheetName: string): CmfProductSpec | null {
  return PRODUCT_BY_SHEET.get(normaliseSheetKey(sheetName)) ?? null
}

export function listCmfProducts(): CmfProductSpec[] {
  return CMF_PRODUCT_CATALOG
}

/**
 * Surface every sheet name the workbook parser will accept, grouped by
 * the parent product so the UI can render a "Recognised tabs: ..." hint
 * next to the file picker.
 *
 * For each top-tier product (no `parentSlug`) we expose:
 *   - a primary tab name — the first `sheetAliases` entry, or the
 *     marketing name if the catalog declares no alias
 *   - the carry case / pouch under that product, when present, with the
 *     same primary-name treatment
 *
 * The shape is intentionally flat-ish (top-level entries with optional
 * `case` siblings) rather than a deep tree so the dialog can show a
 * compact comma-separated list without recursive rendering.
 */
export interface CmfExpectedSheetEntry {
  /** Display label for the primary tab (e.g. "Switch 2"). */
  primary: string
  /** Display label for the carry case / pouch tab if the catalog has one
   *  ("Switch 2 CC"). Null when the product has no nested case. */
  case: string | null
  /** Top-tier product slug — used as a stable React key. */
  productSlug: string
}

export function listExpectedSheetNames(): CmfExpectedSheetEntry[] {
  const tops = CMF_PRODUCT_CATALOG.filter((p) => !p.parentSlug)
  const entries: CmfExpectedSheetEntry[] = []
  for (const top of tops) {
    const child = CMF_PRODUCT_CATALOG.find(
      (p) => p.parentSlug?.toLowerCase() === top.slug.toLowerCase()
    )
    entries.push({
      productSlug: top.slug,
      primary: top.sheetAliases[0] ?? top.name,
      case: child ? child.sheetAliases[0] ?? child.name : null,
    })
  }
  return entries
}

/**
 * Return every product whose `parentSlug` points at the given product —
 * typically zero or one entry (the carry case / pouch). Used by the
 * CMF Studio dropdown to nest case packets as a subsection under the
 * parent earplug or sensewear product.
 */
export function listCmfChildProducts(parentSlug: string): CmfProductSpec[] {
  const key = parentSlug.toLowerCase()
  return CMF_PRODUCT_CATALOG.filter((p) => p.parentSlug?.toLowerCase() === key)
}

/** Resolve a region key to its display label for a given product. */
export function getComponentLabel(productSlug: string, region: string): string {
  const product = getCmfProduct(productSlug)
  const component = product?.components.find((c) => c.region === region)
  return component?.label ?? region
}
