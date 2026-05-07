/**
 * Zod schema for normalised CMF rows.
 *
 * The XLSX parser produces an array of header-keyed objects. This schema
 * accepts those raw rows, normalises them (lower-cases keys, trims values,
 * collapses synonyms like "ProductCode" / "Product Code") and produces the
 * typed shape the rest of the pipeline expects.
 *
 * The component spec is intentionally permissive: the workbook may use
 * column names like `pom_ring_pantone` and `pom_ring_material`, or a
 * single dotted-style header `pom_ring.pantone`. Both shapes get folded
 * into a stable list of component specs keyed by region.
 */

import { z } from 'zod'
import { getCmfProduct, type CmfProductComponent } from './products'

export const ComponentSpecSchema = z.object({
  region: z.string().min(1),
  label: z.string().min(1),
  pantone: z.string().trim().min(1).max(120).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/i, 'colorHex must be a 6-digit hex value')
    .transform((v) => (v.startsWith('#') ? v : `#${v}`))
    .optional(),
  material: z.string().trim().max(120).optional(),
  finish: z.string().trim().max(120).optional(),
  technique: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(500).optional(),
})

export type ComponentSpec = z.infer<typeof ComponentSpecSchema>

export const PaletteSwatchSchema = z.object({
  label: z.string().trim().min(1).max(80),
  pantone: z.string().trim().max(120).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/i, 'colorHex must be a 6-digit hex value')
    .transform((v) => (v.startsWith('#') ? v : `#${v}`))
    .optional(),
})

export type PaletteSwatch = z.infer<typeof PaletteSwatchSchema>

export const CmfSkuRowSchema = z.object({
  /** Optional client-provided id; the API mints one if missing. */
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'label is required').max(160),
  productSlug: z.string().trim().min(1).max(80).transform((v) => v.toLowerCase()),
  variantSlug: z
    .string()
    .trim()
    .max(80)
    .transform((v) => (v ? v.toLowerCase() : 'default'))
    .optional()
    .default('default'),
  productCode: z.string().trim().max(80).optional(),
  ean: z.string().trim().max(40).optional(),
  colorwayName: z.string().trim().max(120).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  packetName: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
  clownAssetSlug: z.string().trim().max(160).optional(),
  /** Optional override; otherwise we use the product's defaultModelId. */
  modelId: z.string().trim().max(128).optional(),
  components: z.array(ComponentSpecSchema).min(1, 'at least one component is required'),
  palette: z.array(PaletteSwatchSchema).optional().default([]),
})

export type CmfSkuRow = z.infer<typeof CmfSkuRowSchema>

export const CmfImportPayloadSchema = z.object({
  /** A friendly name for the resulting packet group. */
  packetName: z.string().trim().min(1).max(160).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  rows: z.array(CmfSkuRowSchema).min(1, 'at least one SKU is required').max(50),
})

export type CmfImportPayload = z.infer<typeof CmfImportPayloadSchema>

/* ─────────────────────────────────────────────────────────────────────────
 * Header normalisation
 *
 * Accepts spreadsheet-style raw rows. Header lookup is case- and separator-
 * insensitive ("Pantone", "pantone", "PANTONE color" all match). We also
 * fold column families like `pom_ring_pantone` / `cosmetic_cap_material`
 * back into the canonical component specs list.
 */

function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const HEADER_ALIASES: Record<string, string[]> = {
  label: ['label', 'sku', 'sku_label', 'name', 'colorway', 'colorway_name'],
  productSlug: ['product_slug', 'product', 'product_code_slug', 'product_id'],
  variantSlug: ['variant_slug', 'variant', 'variant_id'],
  productCode: ['product_code', 'sku_code', 'item_code'],
  ean: ['ean', 'gtin', 'barcode'],
  colorwayName: ['colorway_name', 'colorway', 'colour', 'color'],
  cmfCode: ['cmf_code', 'cmf', 'cmf_revision'],
  packetName: ['packet_name', 'pack', 'pack_name', 'collection'],
  notes: ['notes', 'comment', 'comments'],
  clownAssetSlug: ['clown_slug', 'clown', 'clown_asset', 'reference_clown'],
  modelId: ['model_id', 'model', 'image_model'],
}

const COMPONENT_FIELD_KEYS = ['pantone', 'color_hex', 'material', 'finish', 'technique', 'notes'] as const

interface RawComponentColumn {
  region: string
  field: typeof COMPONENT_FIELD_KEYS[number]
}

function parseComponentColumn(header: string): RawComponentColumn | null {
  const norm = normaliseHeader(header)
  for (const field of COMPONENT_FIELD_KEYS) {
    if (norm.endsWith(`_${field}`)) {
      const region = norm.slice(0, -(field.length + 1))
      if (region.length > 0) {
        return { region, field }
      }
    }
  }
  return null
}

function pickAlias(row: Record<string, unknown>, key: keyof typeof HEADER_ALIASES): string | undefined {
  const aliases = HEADER_ALIASES[key]
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const norm = normaliseHeader(rawKey)
    if (aliases.includes(norm)) {
      if (rawValue == null) return undefined
      const str = String(rawValue).trim()
      return str.length > 0 ? str : undefined
    }
  }
  return undefined
}

function buildComponents(
  row: Record<string, unknown>,
  productComponents: CmfProductComponent[]
): ComponentSpec[] {
  // Only seed regions the user actually wrote about. This keeps SKUs lean —
  // a workbook row that mentions only `pom_ring_pantone` produces exactly
  // one component, even though the product manifest knows about more.
  const partials = new Map<string, Partial<ComponentSpec> & { region: string }>()

  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (rawValue == null) continue
    const value = String(rawValue).trim()
    if (!value) continue

    const parsed = parseComponentColumn(rawKey)
    if (!parsed) continue

    const known = productComponents.find((c) => c.region === parsed.region)
    let partial = partials.get(parsed.region)
    if (!partial) {
      partial = {
        region: parsed.region,
        label: known?.label ?? humanise(parsed.region),
        // Apply catalog defaults only when this is the first time we see
        // the region, so a designer who set just the Pantone still gets a
        // sensible material/finish in the spec sheet.
        material: known?.defaultMaterial,
        finish: known?.defaultFinish,
      }
    }

    if (parsed.field === 'pantone') partial.pantone = value
    if (parsed.field === 'color_hex') partial.colorHex = value
    if (parsed.field === 'material') partial.material = value
    if (parsed.field === 'finish') partial.finish = value
    if (parsed.field === 'technique') partial.technique = value
    if (parsed.field === 'notes') partial.notes = value

    partials.set(parsed.region, partial)
  }

  // Validate each component through Zod. Convert to array first so we don't
  // depend on downlevelIteration of Map.values().
  const filtered: ComponentSpec[] = []
  const partialList = Array.from(partials.values())
  for (const partial of partialList) {
    // Drop entries where the only signal was a default we applied — the
    // designer didn't actually configure this region. We compare against
    // the catalog defaults to detect this.
    const known = productComponents.find((c) => c.region === partial.region)
    const onlyDefaults =
      !partial.pantone &&
      !partial.colorHex &&
      !partial.technique &&
      !partial.notes &&
      partial.material === known?.defaultMaterial &&
      partial.finish === known?.defaultFinish
    if (onlyDefaults) continue

    const candidate = {
      region: partial.region,
      label: partial.label ?? humanise(partial.region),
      pantone: partial.pantone,
      colorHex: partial.colorHex,
      material: partial.material,
      finish: partial.finish,
      technique: partial.technique,
      notes: partial.notes,
    }
    const result = ComponentSpecSchema.safeParse(candidate)
    if (result.success) {
      filtered.push(result.data)
    }
  }
  return filtered
}

function humanise(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

export interface NormalizationError {
  rowIndex: number
  field?: string
  message: string
}

export interface NormalizationResult {
  rows: CmfSkuRow[]
  errors: NormalizationError[]
}

/**
 * Convert raw spreadsheet rows into validated CMF SKU rows.
 *
 * Fail-soft: invalid rows produce structured errors rather than throwing,
 * so the UI can show "row 3: missing productSlug" alongside successful rows.
 */
export function normaliseRawRows(rawRows: Array<Record<string, unknown>>): NormalizationResult {
  const rows: CmfSkuRow[] = []
  const errors: NormalizationError[] = []

  rawRows.forEach((rawRow, index) => {
    if (!rawRow || typeof rawRow !== 'object') {
      errors.push({ rowIndex: index, message: 'row is not an object' })
      return
    }
    const productSlug = pickAlias(rawRow, 'productSlug')
    if (!productSlug) {
      errors.push({
        rowIndex: index,
        field: 'productSlug',
        message: 'productSlug column is required (see template)',
      })
      return
    }

    const product = getCmfProduct(productSlug)
    if (!product) {
      errors.push({
        rowIndex: index,
        field: 'productSlug',
        message: `unknown product slug "${productSlug}"`,
      })
      return
    }

    const components = buildComponents(rawRow, product.components)

    const candidate = {
      label:
        pickAlias(rawRow, 'label') ??
        pickAlias(rawRow, 'colorwayName') ??
        `${product.name} SKU ${index + 1}`,
      productSlug,
      variantSlug: pickAlias(rawRow, 'variantSlug'),
      productCode: pickAlias(rawRow, 'productCode'),
      ean: pickAlias(rawRow, 'ean'),
      colorwayName: pickAlias(rawRow, 'colorwayName'),
      cmfCode: pickAlias(rawRow, 'cmfCode'),
      packetName: pickAlias(rawRow, 'packetName'),
      notes: pickAlias(rawRow, 'notes'),
      clownAssetSlug: pickAlias(rawRow, 'clownAssetSlug'),
      modelId: pickAlias(rawRow, 'modelId'),
      components,
      palette: [] as PaletteSwatch[],
    }

    const parsed = CmfSkuRowSchema.safeParse(candidate)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          rowIndex: index,
          field: issue.path.join('.'),
          message: issue.message,
        })
      }
      return
    }
    rows.push(parsed.data)
  })

  return { rows, errors }
}
