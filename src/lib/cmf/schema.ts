/**
 * Zod schema for normalised CMF rows.
 *
 * Two normalisation paths land here:
 *
 *   1. `normaliseParsedSheets`: takes the rich output of the transposed
 *      workbook parser (one tab per product, one column per SKU) and
 *      produces typed `CmfSkuRow[]` ready for packet creation.
 *   2. `normaliseRawRows`: legacy header-keyed object input from the flat
 *      workbook shape. Kept so the existing template + tests keep working.
 *
 * The component spec is intentionally permissive: a designer may fill only
 * Material+Colour for one region and skip others. Empty SKU columns
 * (placeholder text like "xxxxxxxxxxx") are dropped upstream by the parser
 * so half-filled tabs never block a launch.
 */

import { z } from 'zod'
import { getCmfProduct, type CmfProductComponent } from './products'
import type { ParsedComponent, ParsedSheet, ParsedSkuRow } from './xlsx'

export const ComponentSpecSchema = z.object({
  region: z.string().min(1),
  label: z.string().min(1),
  pantone: z.string().trim().min(1).max(160).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/i, 'colorHex must be a 6-digit hex value')
    .transform((v) => (v.startsWith('#') ? v : `#${v}`))
    .optional(),
  material: z.string().trim().max(160).optional(),
  finish: z.string().trim().max(160).optional(),
  technique: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(800).optional(),
})

export type ComponentSpec = z.infer<typeof ComponentSpecSchema>

export const PaletteSwatchSchema = z.object({
  label: z.string().trim().min(1).max(80),
  pantone: z.string().trim().max(160).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/i, 'colorHex must be a 6-digit hex value')
    .transform((v) => (v.startsWith('#') ? v : `#${v}`))
    .optional(),
})

export type PaletteSwatch = z.infer<typeof PaletteSwatchSchema>

export const CmfSkuRowSchema = z.object({
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
  colorwayName: z.string().trim().max(160).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  packetName: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
  clownAssetSlug: z.string().trim().max(160).optional(),
  modelId: z.string().trim().max(128).optional(),
  components: z.array(ComponentSpecSchema).min(1, 'at least one component is required'),
  palette: z.array(PaletteSwatchSchema).optional().default([]),
})

export type CmfSkuRow = z.infer<typeof CmfSkuRowSchema>

export const CmfImportPayloadSchema = z.object({
  packetName: z.string().trim().min(1).max(160).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  rows: z.array(CmfSkuRowSchema).min(1, 'at least one SKU is required').max(100),
})

export type CmfImportPayload = z.infer<typeof CmfImportPayloadSchema>

export interface NormalizationError {
  rowIndex: number
  field?: string
  message: string
  sheetName?: string
}

export interface NormalizationResult {
  rows: CmfSkuRow[]
  errors: NormalizationError[]
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transposed normalisation
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Convert parsed sheets from the transposed workbook into validated rows.
 *
 * Each sheet maps to one product; each SKU column in that sheet maps to
 * one CmfSkuRow. Empty SKU columns have already been dropped by the parser
 * so we just need to flatten and validate.
 */
export function normaliseParsedSheets(
  sheets: ParsedSheet[]
): NormalizationResult {
  const rows: CmfSkuRow[] = []
  const errors: NormalizationError[] = []
  let rowCounter = 0

  for (const sheet of sheets) {
    const product = getCmfProduct(sheet.productSlug)
    if (!product) {
      errors.push({
        rowIndex: rowCounter,
        field: 'productSlug',
        message: `Unknown product slug "${sheet.productSlug}" for sheet "${sheet.sheetName}"`,
        sheetName: sheet.sheetName,
      })
      continue
    }

    for (const sku of sheet.skus) {
      const index = rowCounter++
      const components = sku.components
        .map((c) => mergeWithCatalog(c, product.components))
        .filter((c): c is ComponentSpec => c !== null)

      if (components.length === 0) {
        errors.push({
          rowIndex: index,
          field: 'components',
          message: `SKU "${sku.skuLabel}" on sheet "${sheet.sheetName}" has no component data`,
          sheetName: sheet.sheetName,
        })
        continue
      }

      const colorwayName =
        cleanField(sku.banner.productName) ??
        cleanField(sku.skuLabel) ??
        `${product.name} ${index + 1}`
      const labelParts = [product.name, cleanField(sku.banner.productName) ?? cleanField(sku.skuLabel)].filter(
        (v): v is string => Boolean(v)
      )
      const label = labelParts.length > 1 ? `${product.name} — ${labelParts[1]}` : labelParts[0] || `${product.name} SKU`

      const candidate = {
        label,
        productSlug: product.slug,
        variantSlug: 'default',
        productCode: cleanField(sku.banner.productCode),
        ean: cleanField(sku.banner.ean),
        colorwayName,
        cmfCode: cleanField(sku.banner.cmfNumber),
        packetName: cleanField(sheet.collection ?? sheet.productName),
        notes: bannerNotes(sku),
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
            sheetName: sheet.sheetName,
          })
        }
        continue
      }
      rows.push(parsed.data)
    }
  }
  return { rows, errors }
}

function mergeWithCatalog(
  parsed: ParsedComponent,
  catalog: CmfProductComponent[]
): ComponentSpec | null {
  // Match by region first, then by label (case-insensitive). The workbook
  // labels often match the catalog labels exactly, but we tolerate drift.
  const byRegion = catalog.find((c) => c.region === parsed.region)
  const byLabel = catalog.find(
    (c) => c.label.toLowerCase() === parsed.label.toLowerCase()
  )
  const known = byRegion ?? byLabel
  const candidate: Record<string, unknown> = {
    region: known?.region ?? parsed.region,
    label: known?.label ?? parsed.label,
  }
  if (parsed.pantone) candidate.pantone = parsed.pantone.slice(0, 160)
  if (parsed.colorHex) candidate.colorHex = parsed.colorHex
  if (parsed.material) candidate.material = parsed.material.slice(0, 160)
  else if (known?.defaultMaterial) candidate.material = known.defaultMaterial
  if (parsed.finish) candidate.finish = parsed.finish.slice(0, 160)
  else if (known?.defaultFinish) candidate.finish = known.defaultFinish
  if (parsed.technique) candidate.technique = parsed.technique.slice(0, 200)
  if (parsed.notes) candidate.notes = parsed.notes.slice(0, 800)

  const result = ComponentSpecSchema.safeParse(candidate)
  return result.success ? result.data : null
}

function cleanField(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^x+$/i.test(trimmed)) return undefined
  if (/^xxxxxxxxxxx$/i.test(trimmed)) return undefined
  return trimmed
}

function bannerNotes(sku: ParsedSkuRow): string | undefined {
  const parts: string[] = []
  const editDate = cleanField(sku.banner.editDate)
  const drawnBy = cleanField(sku.banner.drawnBy)
  const checkedBy1 = cleanField(sku.banner.checkedBy1)
  const checkedBy2 = cleanField(sku.banner.checkedBy2)
  if (editDate) parts.push(`Edit date: ${editDate}`)
  if (drawnBy) parts.push(`Drawn by: ${drawnBy}`)
  if (checkedBy1) parts.push(`Checked by: ${checkedBy1}`)
  if (checkedBy2 && checkedBy2 !== checkedBy1) parts.push(`Checked by (2): ${checkedBy2}`)
  return parts.length ? parts.join(' · ') : undefined
}

/* ────────────────────────────────────────────────────────────────────────────
 * Header normalisation (flat / legacy format)
 *
 * Accepts spreadsheet-style raw rows where each row = one SKU. Header lookup
 * is case- and separator-insensitive. We also fold column families like
 * `pom_ring_pantone` back into the canonical component specs list.
 * ────────────────────────────────────────────────────────────────────────── */

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
  ean: ['ean', 'gtin', 'barcode', 'ean_code'],
  colorwayName: ['colorway_name', 'colorway', 'colour', 'color'],
  cmfCode: ['cmf_code', 'cmf', 'cmf_revision', 'cmf_number'],
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

  const filtered: ComponentSpec[] = []
  const partialList = Array.from(partials.values())
  for (const partial of partialList) {
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
    if (result.success) filtered.push(result.data)
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
