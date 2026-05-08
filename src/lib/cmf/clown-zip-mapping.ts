/**
 * Canonical mapping from "Clown Renders" zip filenames to (productSlug,
 * variantSlug, label) triples.
 *
 * The mapping lives here — not inside the API route — so the seed script
 * (`scripts/seed-cmf-clowns.mjs`) and the bulk-upload endpoint can stay in
 * lockstep. Adding a new zip means one edit, in one place, with the rules
 * documented next to the code that uses them.
 *
 * Convention:
 *   - Zip name -> productSlug (lookup table below).
 *   - Inner PNG filename -> variantSlug (via `deriveVariantSlug`):
 *       lowercased, slugified, with the product prefix stripped if it just
 *       repeats the product name. Designers prefer terse keys like
 *       "motorsport-615" or "satin", not "switch2-motorsport-exploration-615".
 *   - Inner PNG filename -> label (via `deriveLabel`):
 *       title-cased, with the extension dropped.
 */

import { getCmfProduct } from './products'

export interface ClownZipMatch {
  productSlug: string
  variantSlug: string
  label: string
}

/**
 * Lower-cased zip basename (without `.zip`) -> productSlug. Keep the keys
 * normalised so callers don't need to worry about file system case quirks.
 */
const ZIP_TO_PRODUCT: Record<string, string> = {
  'aphrodite clown for claude': 'aphrodite',
  'carry case aphrodite': 'case-aphrodite',
  'carry case clown': 'case',
  'carry case dream clown': 'case-dream',
  'clown engage': 'engage2',
  'clown experience satin and glossy': 'experience2',
  'clown pouch link': 'pouch-link',
  cocoon_clown: 'cocoon',
  'dream clown': 'dream',
  'link clown': 'link',
  'switch 2 clown for claude': 'switch2',
}

/**
 * Look up the productSlug for a zip filename. Returns `null` for zips not
 * in the canonical mapping — callers should surface that as a soft error
 * rather than silently dropping uploads.
 */
export function productSlugForZip(zipFilename: string): string | null {
  const stem = stripZipExtension(zipFilename).toLowerCase().trim()
  const slug = ZIP_TO_PRODUCT[stem] ?? null
  if (!slug) return null
  // Defence-in-depth: also confirm the catalog still knows about this slug.
  return getCmfProduct(slug) ? slug : null
}

/**
 * Derive a variant slug from an inner PNG filename. Tuned for the naming
 * conventions designers actually use — bracketed numbers, dot-separated
 * SKU codes, "satin"/"glossy" finishes, etc. — without forcing them into a
 * rigid template.
 *
 *   - "image (38).png" + product "aphrodite" -> "image-38"
 *   - "Switch2 motorsport exploration.615.png" + "switch2" -> "motorsport-615"
 *   - "carry case 7613.555.png" + "case-aphrodite" -> "7613-555"
 *   - "carry case clown 1.png" + "case" -> "v1"   (numeric-only -> prefixed)
 *   - "DR_clown.png" + "dream" -> "default"      (only the product name -> default)
 */
export function deriveVariantSlug(
  innerFilename: string,
  productSlug: string
): string {
  const base = stripPngExtension(innerFilename)
  // Strip the product display name / common synonyms when they're just a
  // prefix repeating the productSlug. We compare on a normalised form.
  const product = getCmfProduct(productSlug)
  const prefixesToStrip = new Set<string>()
  if (product) {
    prefixesToStrip.add(slugify(product.name))
    prefixesToStrip.add(slugify(product.slug))
  }
  // Common shorthand prefixes we see in the source files.
  const shorthand: Record<string, string[]> = {
    aphrodite: ['aphrodite-clown', 'image'],
    'case-aphrodite': ['carry-case-aphrodite', 'carry-case'],
    case: ['carry-case-clown', 'carry-case'],
    'case-dream': ['carry-case-dream-clown', 'carry-case-dream'],
    engage2: ['clown-engage', 'engage'],
    experience2: ['clown-experience'],
    'pouch-link': ['clown-pouch-link'],
    cocoon: ['cocoon-clown', 'cocoon'],
    dream: ['dream-clown', 'dr-clown', 'dr'],
    link: ['link-clown'],
    // Note: we deliberately don't strip "switch2-motorsport-exploration"
    // here. Doing so collapses motorsport variants to bare numerics like
    // "615", which then become "v615" — losing the "motorsport" cue
    // designers care about. We only strip the bare product prefix.
    switch2: ['switch2-clown', 'switch-2-clown'],
  }
  for (const p of shorthand[productSlug] ?? []) {
    prefixesToStrip.add(p)
  }

  let slug = slugify(base)
  // Strip the longest matching prefix once.
  const sortedPrefixes = Array.from(prefixesToStrip).sort(
    (a, b) => b.length - a.length
  )
  for (const prefix of sortedPrefixes) {
    if (!prefix) continue
    if (slug === prefix) {
      slug = ''
      break
    }
    if (slug.startsWith(`${prefix}-`)) {
      slug = slug.slice(prefix.length + 1)
      break
    }
  }

  if (!slug) return 'default'

  // If what's left is purely digits, it's a sort-order suffix from a hand
  // export — e.g. "carry case clown 1.png" -> "1". Pad with "v" so the slug
  // reads as a label in URLs and database rows.
  if (/^\d+$/.test(slug)) {
    return `v${slug}`
  }

  // Special case: Switch2 motorsport renders compress nicely.
  slug = slug.replace(/^motorsport-exploration-/, 'motorsport-')

  return slug
}

/** Human-readable label derived from the inner filename. */
export function deriveLabel(innerFilename: string): string {
  const base = stripPngExtension(innerFilename).replace(/[._]+/g, ' ').trim()
  return base.replace(/\s+/g, ' ')
}

/**
 * One-shot helper: zip filename + inner PNG filename -> full mapping. Returns
 * null if the zip doesn't match any product.
 */
export function clownAssetFromZipEntry(
  zipFilename: string,
  innerFilename: string
): ClownZipMatch | null {
  const productSlug = productSlugForZip(zipFilename)
  if (!productSlug) return null
  return {
    productSlug,
    variantSlug: deriveVariantSlug(innerFilename, productSlug),
    label: deriveLabel(innerFilename),
  }
}

/* ─── helpers ──────────────────────────────────────────────────────────── */

function stripZipExtension(name: string): string {
  return name.replace(/\.zip$/i, '')
}

function stripPngExtension(name: string): string {
  return name.replace(/\.(png|jpg|jpeg)$/i, '')
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
