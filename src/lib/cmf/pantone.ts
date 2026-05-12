/**
 * Pantone → hex resolution for the CMF prompt builder.
 *
 * Why this exists: Damien's CMF workbooks specify colours by Pantone code
 * only (e.g. `Pantone 7720 C`, `PANTONE 17-5641 TCX`). Vision-language
 * models like Gemini Nano Banana / Replicate Seedream do not reliably
 * resolve Pantone codes mentally — they treat the code as a text token and
 * end up approximating the colour from context. When the reference image
 * is a clown (multi-coloured by design), the model often borrows the
 * clown's saturated identifier colours instead of the requested Pantone.
 *
 * Plugging a numeric hex into the prompt fixes this dramatically. The
 * hex doesn't have to be Pantone-perfect — even an approximate sRGB
 * conversion gives the model an unambiguous target it can lock onto.
 *
 * Two sources:
 *   1. The `pantone-colors` npm package (MIT, no runtime deps) ships ~1100
 *      Solid Coated codes keyed by short number (e.g. `7720`, `1777`).
 *      Covers most of Pantone Solid Coated.
 *   2. A curated `TCX_HEX` table below covers Pantone Textile Cotton
 *      eXtended codes (5-digit dashed format like `17-5641 TCX`). The
 *      `pantone-colors` package does not include TCX, so we vendor a
 *      starter set focused on the codes Loop's workbooks have used so far
 *      plus a broader product/fashion-design palette. Add new codes here
 *      as workbooks introduce them.
 *
 * The lookup is tolerant of formatting variations:
 *   - "Pantone 7720 C" / "PANTONE 7720C" / "7720" / "7720 c" → 7720
 *   - "PANTONE 17-5641 TCX" / "17-5641 tcx" / "17-5641" → 17-5641
 *
 * Unknown codes return null. Callers (currently `enrichComponentColour`)
 * leave `colorHex` empty when the lookup misses — the prompt still names
 * the Pantone code so the factory has the canonical reference, just
 * without a hex anchor for the model. The system logs a warning so
 * unknown codes surface for future vendoring.
 */

import pantoneColors from 'pantone-colors'

/**
 * Vendored Pantone → approximate hex extensions.
 *
 * Why a single table for two code families: `pantone-colors` ships ~900
 * Solid Coated codes but only in the 100–5875 range. Workbooks routinely
 * use codes outside that range (the 7000-series for product palettes;
 * the dashed TCX/TPG/TPX codes for textiles), so we layer this table
 * over the npm package. Keys are the normalised lookup form used by
 * `lookupPantoneHex` — i.e. `7720` for "Pantone 7720 C" and `17-5641`
 * for "PANTONE 17-5641 TCX".
 *
 * Values are widely-cited sRGB approximations from public Pantone
 * references; they are NOT a substitute for a calibrated Pantone-to-sRGB
 * conversion when colour-critical fidelity is required. For the CMF
 * prompt their purpose is to give the image model a numeric anchor —
 * the factory still works from the Pantone code itself.
 *
 * Keep entries sorted by code within each section for easy diffing as
 * the table grows.
 */
const EXTENSIONS_HEX: Record<string, string> = {
  // ── Solid Coated 7000-series (gap in pantone-colors) ─────────────────
  // Common product-design palette. Used by Loop's Switch 2 packs.
  '7400': '#f1d6a7', // pale buff
  '7401': '#f2e1c6',
  '7403': '#eed484',
  '7404': '#f4cc35',
  '7406': '#f0c419',
  '7408': '#f1ab00',
  '7409': '#ee9b00',
  '7410': '#ffb380',
  '7411': '#dca16b',
  '7414': '#bf7b3f',
  '7416': '#e8624c',
  '7417': '#df3d2d',
  '7418': '#cf4f5e',
  '7420': '#b32346',
  '7421': '#710c1f',
  '7422': '#efc8d1',
  '7424': '#dc5491',
  '7425': '#b51e6a',
  '7427': '#9c193a',
  '7429': '#dcb2c4',
  '7432': '#b97d9e',
  '7433': '#a04875',
  '7435': '#822c5f',
  '7436': '#e6dff0',
  '7440': '#a99cca',
  '7443': '#dde2ef',
  '7444': '#9aa2cc',
  '7448': '#4c4d6d',
  '7450': '#b1c2db',
  '7451': '#86a4d4',
  '7452': '#8c98c8',
  '7453': '#a4baea',
  '7455': '#3a4ea1',
  '7456': '#6776b6',
  '7457': '#b7d8e7',
  '7458': '#6a9bbc',
  '7459': '#347ba0',
  '7460': '#0085c3',
  '7461': '#1d80c5',
  '7463': '#003056',
  '7466': '#00a9ce',
  '7468': '#005f86',
  '7469': '#005776',
  '7470': '#005a70',
  '7471': '#7adcd8',
  '7473': '#3a978a',
  '7474': '#006272',
  '7475': '#4a777a',
  '7476': '#005052',
  '7477': '#264a60',
  '7478': '#a5e5a5',
  '7479': '#2dcb74',
  '7480': '#00b760',
  '7481': '#00a754',
  '7482': '#009245',
  '7483': '#005826',
  '7484': '#006a37',
  '7485': '#dde7c9',
  '7486': '#bce5a3',
  '7487': '#7fd17a',
  '7488': '#62cf66',
  '7490': '#5e9732',
  '7493': '#bcc298',
  '7494': '#94a76c',
  '7495': '#7c8a3a',
  '7496': '#677029',
  '7497': '#6e624c',
  '7499': '#f1ead7',
  '7500': '#decba1',
  '7501': '#d2b88c',
  '7502': '#c7a877',
  '7503': '#a89968',
  '7504': '#7d6a3e',
  '7505': '#5d4a1f',
  '7506': '#e8d3a8',
  '7507': '#f2bf86',
  '7508': '#d6a667',
  '7509': '#c69053',
  '7510': '#b07d3e',
  '7511': '#9e6a2c',
  '7512': '#8b4f24',
  '7513': '#c79b76',
  '7514': '#b5825b',
  '7515': '#a4694b',
  '7516': '#7d4727',
  '7517': '#673418',
  '7518': '#604f4a',
  '7519': '#4a423d',
  '7520': '#e0c2bb',
  '7521': '#bf9b94',
  '7522': '#9d6c6b',
  '7523': '#a35b58',
  '7524': '#c95c45',
  '7525': '#c47a59',
  '7526': '#a55a32',
  '7527': '#d6cfc1',
  '7528': '#c4b8a5',
  '7529': '#a99980',
  '7530': '#8d7d63',
  '7531': '#6f604b',
  '7532': '#5a4a36',
  '7533': '#43361f',
  '7534': '#d2c5a0',
  '7535': '#b9ad88',
  '7536': '#a09572',
  '7537': '#c9d3c1',
  '7538': '#b3bea9',
  '7539': '#a4ada1',
  '7540': '#4a5359',
  '7541': '#dde5e6',
  '7542': '#a4b5b8',
  '7543': '#98a4ae',
  '7544': '#727f88',
  '7545': '#4b5d6e',
  '7546': '#34495e',
  '7547': '#1d2c40',
  '7548': '#ffce00',
  '7549': '#ffb300',
  '7550': '#cd8500',
  '7551': '#a9651b',
  '7552': '#85561e',
  '7553': '#6a4d1c',
  '7554': '#503c19',
  '7555': '#cf7c1d',
  '7556': '#b8702a',
  '7557': '#a06424',
  '7558': '#83571f',
  '7560': '#604325',
  '7562': '#b18d54',
  '7563': '#d29a3b',
  '7564': '#dba43a',
  '7565': '#bb7e2f',
  '7566': '#9c692a',
  '7567': '#825625',
  '7568': '#6c4a26',
  '7569': '#d27c2d',
  '7570': '#d2a16a',
  '7571': '#b5803f',
  '7572': '#a06d2f',
  '7574': '#7a5223',
  '7575': '#623f1f',
  '7576': '#c45f3a',
  '7577': '#b3502f',
  '7578': '#9d4628',
  '7580': '#7a3a1f',
  '7582': '#6b3f1d',
  '7595': '#947857',
  '7596': '#8a6c4a',
  '7600': '#7e6a4a',
  '7610': '#bf957f',
  '7616': '#9a7758',
  '7625': '#d6543e',
  '7627': '#9c2b2c',
  '7630': '#7c2030',
  '7637': '#a45a72',
  '7647': '#902f4b',
  '7649': '#7d2c46',
  '7651': '#866088',
  '7652': '#6e4172',
  '7656': '#4f3866',
  '7660': '#7282a4',
  '7665': '#5d6a8a',
  '7667': '#5b6a83',
  '7669': '#535a6a',
  '7674': '#6a87b0',
  '7677': '#7a5d8e',
  '7679': '#3d2562',
  '7681': '#a3c0e5',
  '7686': '#0048a6',
  '7689': '#1f72b5',
  '7691': '#005a8b',
  '7693': '#003b67',
  '7700': '#1c7fa0',
  '7705': '#2a89a0',
  '7708': '#0094a6',
  '7709': '#3f9aa4',
  '7710': '#00929a',
  '7715': '#009f8a',
  '7716': '#008a7a',
  '7717': '#007266',
  '7720': '#247b5e', // Switch 2 Emerald (Damien's Switch 2 fixture)
  '7723': '#3b8053',
  '7724': '#5da450',
  '7725': '#4c8c2f',
  '7727': '#458146',
  '7728': '#386b3b',
  '7729': '#2f5d30',
  '7730': '#1f4825',
  '7732': '#4e6e1d',
  '7733': '#5c7c1c',
  '7734': '#688220',
  '7735': '#6f8625',
  '7737': '#728c33',
  '7741': '#7ca632',
  '7745': '#aab43a',
  '7747': '#d5b228',
  '7749': '#bda21d',
  '7750': '#a48a1a',
  '7751': '#a37e16',
  '7752': '#9a751a',
  '7753': '#806122',
  '7754': '#735524',
  '7755': '#5e4419',
  '7757': '#aa8a18',
  '7758': '#a98718',
  '7760': '#85620a',
  // ── TCX (Pantone Textile Cotton eXtended) ────────────────────────────
  // Whites / off-whites
  '11-0601': '#f4f5f0', // Bright White
  '11-0602': '#f2f0eb', // Snow White
  '11-0103': '#f0eee9', // Egret
  '11-4001': '#edf1fe', // Brilliant White
  '11-4202': '#dee5e9', // Cloud Blue
  '12-0304': '#e7e0d3', // Vanilla Custard

  // ── Greens / teals (Loop's "Emerald" family) ─────────────────────────
  '12-5409': '#bce4c6', // Honeydew
  '15-0146': '#74aa50', // Greenery
  '15-5519': '#16a085', // Persian Green-ish
  '16-5938': '#00a591', // Arcadia
  '17-5641': '#009969', // Emerald (Switch 2 Emerald colourway)
  '18-5418': '#1c5d44', // Eden
  '18-5845': '#0c5847', // Forest Green-ish
  '19-5511': '#264e36', // Pine Grove

  // ── Yellows / golds (Loop's "Gold" family) ───────────────────────────
  '13-0858': '#fbd87f', // Aspen Gold
  '14-0848': '#fcb437', // Saffron
  '14-1064': '#ed8b00', // Bright Marigold
  '15-1247': '#f0945d', // Apricot Buff
  '16-0950': '#bc8d49', // Honey Gold

  // ── Reds / pinks ─────────────────────────────────────────────────────
  '15-1520': '#e8a09f', // Rose Tan
  '16-1546': '#cb6c4f', // Coral
  '17-1462': '#dd4124', // Tangerine Tango
  '17-1546': '#cf3636', // Aurora Red
  '17-1937': '#e8888a', // Rose
  '18-1438': '#b53e3a', // Marsala
  '18-1664': '#bd3c39', // Fiery Red
  '18-2120': '#b93a59', // Honeysuckle
  '19-1557': '#7c2128', // Chili Pepper
  '19-1726': '#9a1f40', // Sangria
  '19-1764': '#bf1932', // True Red

  // ── Blues ────────────────────────────────────────────────────────────
  '13-4308': '#cad7e0', // Skyway
  '14-4123': '#a0c1d1', // Forget-Me-Not
  '14-4313': '#82a1b4', // Stone Blue
  '15-3920': '#7da7d9', // Little Boy Blue
  '16-4519': '#76b6c4', // Aquarius
  '17-3938': '#5a5b9f', // Dazzling Blue
  '17-4435': '#0089cf', // Mediterranean Blue
  '18-3838': '#6667ab', // Ultra Violet
  '18-3949': '#3d6cb6', // Lapis Blue
  '18-4140': '#0085a1', // Mykonos Blue
  '18-4525': '#0f4c5c', // Mosaic Blue
  '18-4622': '#326480', // Deep Lagoon
  '19-3536': '#5d3754', // Plum Caspia
  '19-4052': '#0f4c81', // Classic Blue

  // ── Browns / tans ────────────────────────────────────────────────────
  '15-1308': '#b8a98c', // Frappe
  '16-1334': '#a08160', // Tawny Birch
  '18-1142': '#925b25', // Cathay Spice
  '18-1454': '#a14622', // Burnt Sienna

  // ── Greys / blacks (Loop's neutral families) ─────────────────────────
  '17-5104': '#85857f', // Ultimate Gray
  '18-0201': '#5b5b5b', // Steel Gray
  '18-5102': '#5e6063', // Granite Gray
  '19-0303': '#2d2a28', // Jet Black
  '19-4007': '#1e1f22', // Caviar
}

/** Normalise a raw Pantone code into something the lookups can match. */
function normalisePantoneInput(raw: string): string {
  return raw
    .replace(/^pantone\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a Pantone code to its approximate sRGB hex value, or null when
 * the code is unknown. Tolerant of "Pantone "/"PANTONE " prefix, optional
 * trailing letter (C/CP/U/PC), and dashed TCX format.
 */
export function lookupPantoneHex(code: string | null | undefined): string | null {
  if (!code) return null
  const trimmed = String(code).trim()
  if (!trimmed) return null

  const stripped = normalisePantoneInput(trimmed)

  // TCX / TPG / TPX: 5-digit dash format, e.g. "17-5641 TCX".
  const tcxMatch = /^(\d{2}-\d{4})(?:\s*(tcx|tpg|tpx))?$/i.exec(stripped)
  if (tcxMatch) {
    const key = tcxMatch[1]
    return EXTENSIONS_HEX[key] ?? null
  }

  // Solid Coated / Uncoated: digits with optional trailing letter.
  // Examples: "7720", "7720 C", "7720C", "1777 CP", "Black 6 C" (which we
  // can't resolve numerically — bail out to null for caller's warning).
  const solidMatch = /^(\d{1,4})\s*(c|cp|u|pc|cu)?$/i.exec(stripped)
  if (solidMatch) {
    const key = solidMatch[1]
    // Extensions table first (covers the 7000-series gap), then the
    // bundled `pantone-colors` package for everything in 100–5875.
    const ext = EXTENSIONS_HEX[key]
    if (ext) return ext
    const table = pantoneColors as unknown as Record<string, string>
    return table[key] ?? null
  }

  return null
}

/**
 * Pure helper: returns a new component object with `colorHex` filled from
 * the Pantone code when (a) `colorHex` is empty and (b) the lookup
 * succeeds. Leaves the input untouched otherwise.
 *
 * Used at the parser boundary (`schema.ts`) so the enriched hex is
 * persisted to `cmf_renders.componentSpecs` and flows through prompt, PDF
 * swatches, and HTML preview without further plumbing.
 */
export function enrichComponentColour<
  T extends { pantone?: string | null; colorHex?: string | null } | Record<string, unknown>
>(component: T): T & { colorHex?: string | null } {
  const cast = component as { pantone?: string | null; colorHex?: string | null }
  if (cast.colorHex) return component as T & { colorHex?: string | null }
  if (!cast.pantone) return component as T & { colorHex?: string | null }
  const hex = lookupPantoneHex(cast.pantone)
  if (!hex) return component as T & { colorHex?: string | null }
  return { ...component, colorHex: hex } as T & { colorHex?: string | null }
}

/**
 * Returns true when the component carries a Pantone code we couldn't
 * resolve to a hex. Useful for logging an aggregated warning at parse
 * time so the team knows which codes to vendor into `TCX_HEX` or audit
 * upstream in `pantone-colors`.
 */
export function hasUnresolvedPantone(component: {
  pantone?: string | null
  colorHex?: string | null
}): boolean {
  if (component.colorHex) return false
  if (!component.pantone) return false
  return lookupPantoneHex(component.pantone) === null
}
