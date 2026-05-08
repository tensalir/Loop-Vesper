/**
 * Canonical Loop product catalog used by the CMF flow. The list is intentionally
 * small in v1: every product slug here corresponds to a clown PNG that lives in
 * `c:\Users\buyss\OneDrive - Loop\Creative Technology\04_Projects\09_Vesper\04_Forks\01_CMF`.
 *
 * Components describe the named, recolourable surfaces of each product so the
 * prompt builder can speak about them in plain English ("POM ring", "cosmetic
 * cap") rather than hex regions. The clown PNG and these components together
 * form the contract a designer fills in via the workbook.
 *
 * Why a static manifest instead of a DB lookup?
 *  - The component vocabulary is brand/product domain knowledge, not user
 *    data. Hard-coding it lets us validate workbook columns at parse time.
 *  - New products land via a code change + a new clown PNG, both of which we
 *    want code review to gate.
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
  components: CmfProductComponent[]
  /** Default Vesper image model for this product's recolour pass. */
  defaultModelId: string
  /** Short prompt fragment describing the product so the model gets framing right. */
  promptDescriptor: string
}

const NANO_BANANA_PRO = 'gemini-nano-banana-pro'

export const CMF_PRODUCT_CATALOG: CmfProductSpec[] = [
  {
    slug: 'switch2',
    name: 'Loop Switch 2',
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Switch 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'mode_indicator', label: 'Mode indicator', defaultMaterial: 'PC' },
    ],
  },
  {
    slug: 'engage2',
    name: 'Loop Engage 2',
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Engage 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'experience2',
    name: 'Loop Experience 2',
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Experience 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'quiet2',
    name: 'Loop Quiet 2',
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Quiet 2 earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'silicone_body', label: 'Silicone body', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'aphrodite',
    name: 'Loop Aphrodite',
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Aphrodite earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'jewel_accent', label: 'Jewel accent', defaultMaterial: 'PC' },
    ],
  },
  {
    slug: 'case',
    name: 'Loop Carry Case',
    category: 'case',
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
    slug: 'case-aphrodite',
    name: 'Loop Aphrodite Carry Case',
    category: 'case',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Aphrodite carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell', label: 'Outer shell', defaultMaterial: 'PC/ABS' },
      { region: 'lid', label: 'Lid', defaultMaterial: 'PC/ABS' },
      { region: 'tray', label: 'Inner tray', defaultMaterial: 'TPU' },
      { region: 'lanyard', label: 'Lanyard', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'jewel_accent', label: 'Jewel accent', defaultMaterial: 'PC' },
    ],
  },
  // ─── 20260508 additions: products referenced by the seeded clown library
  // but not yet present in v1. Component lists mirror the closest existing
  // product so workbook validators have something to bind to; refine in code
  // review as the CMF spec firms up for each one.
  {
    slug: 'dream',
    name: 'Loop Dream',
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Dream earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pom_ring', label: 'POM ring', defaultMaterial: 'POM' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', defaultMaterial: 'PC/ABS' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'link',
    name: 'Loop Link',
    category: 'earplug',
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
    category: 'earplug',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a pair of Loop Cocoon earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'silicone_body', label: 'Silicone body', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
      { region: 'silicone_tip', label: 'Silicone tip', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'case-dream',
    name: 'Loop Dream Carry Case',
    category: 'case',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a Loop Dream carry case, opened and closed views, studio-lit hero render, neutral background',
    components: [
      { region: 'shell', label: 'Outer shell', defaultMaterial: 'PC/ABS' },
      { region: 'lid', label: 'Lid', defaultMaterial: 'PC/ABS' },
      { region: 'tray', label: 'Inner tray', defaultMaterial: 'TPU' },
      { region: 'lanyard', label: 'Lanyard', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
  {
    slug: 'pouch-link',
    name: 'Loop Link Pouch',
    category: 'case',
    defaultModelId: NANO_BANANA_PRO,
    promptDescriptor:
      'a soft pouch carrier for Loop Link earplugs, studio-lit hero render, neutral background',
    components: [
      { region: 'pouch_body', label: 'Pouch body', defaultMaterial: 'Silicone', defaultFinish: 'Matte' },
    ],
  },
]

const PRODUCT_BY_SLUG = new Map(
  CMF_PRODUCT_CATALOG.map((p) => [p.slug, p])
)

export function getCmfProduct(slug: string): CmfProductSpec | null {
  return PRODUCT_BY_SLUG.get(slug.toLowerCase()) ?? null
}

export function listCmfProducts(): CmfProductSpec[] {
  return CMF_PRODUCT_CATALOG
}

/** Resolve a region key to its display label for a given product. */
export function getComponentLabel(productSlug: string, region: string): string {
  const product = getCmfProduct(productSlug)
  const component = product?.components.find((c) => c.region === region)
  return component?.label ?? region
}
