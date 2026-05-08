#!/usr/bin/env node
/**
 * CMF Clown Library Seed Script
 *
 * Reads the canonical "Clown Renders" zip pack from a local folder and
 * uploads each PNG inside as a global CmfClownAsset row. The mapping table
 * below mirrors `src/lib/cmf/clown-zip-mapping.ts` so this script and the
 * /api/cmf/clowns/bulk endpoint stay in lockstep — if you add a zip,
 * update both places.
 *
 * Usage:
 *   node scripts/seed-cmf-clowns.mjs --source "<folder with zips>"
 *
 * Options:
 *   --source <path>   Folder containing the .zip files (required)
 *   --dry-run         Print what would happen without touching DB / storage
 *   --overwrite       Re-upload PNG and update DB row even if it already exists
 *   --only <slug>     Only seed a specific productSlug (e.g. switch2)
 *
 * Environment:
 *   DATABASE_URL              Postgres connection string (Prisma)
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Supabase service role key
 *
 * Idempotent — safe to re-run. Without --overwrite, existing
 * (productSlug, variantSlug) rows are left alone.
 */

import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// ─── env loader (mirrors scripts/import-product-renders.mjs) ──────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
async function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '..', '.env.local'),
    path.resolve(__dirname, '..', '.env'),
  ]
  for (const p of candidates) {
    try {
      const content = await fs.readFile(p, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const [key, ...rest] = trimmed.split('=')
        if (key && rest.length > 0) {
          process.env[key.trim()] = rest
            .join('=')
            .trim()
            .replace(/^["']|["']$/g, '')
        }
      }
      return p
    } catch {
      /* try next */
    }
  }
  return null
}

await loadEnv()

// ─── arg parsing ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
function flag(name) {
  return argv.includes(`--${name}`)
}
function arg(name) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : null
}

const SOURCE = arg('source')
const DRY_RUN = flag('dry-run')
const OVERWRITE = flag('overwrite')
const ONLY = arg('only')?.toLowerCase() ?? null

if (!SOURCE) {
  console.error(
    'Missing --source <folder>. Pass the folder containing the .zip files.\n' +
      'Example:\n' +
      '  node scripts/seed-cmf-clowns.mjs --source "C:\\Users\\buyss\\OneDrive - Loop\\...\\Clown Renders"'
  )
  process.exit(1)
}

// ─── canonical zip -> product mapping ────────────────────────────────────

// Lower-cased zip basename (without `.zip`) -> productSlug. Keep aligned
// with src/lib/cmf/clown-zip-mapping.ts.
const ZIP_TO_PRODUCT = {
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

const PRODUCT_DISPLAY_NAMES = {
  switch2: 'Loop Switch 2',
  engage2: 'Loop Engage 2',
  experience2: 'Loop Experience 2',
  quiet2: 'Loop Quiet 2',
  aphrodite: 'Loop Aphrodite',
  case: 'Loop Carry Case',
  'case-aphrodite': 'Loop Aphrodite Carry Case',
  dream: 'Loop Dream',
  link: 'Loop Link',
  cocoon: 'Loop Cocoon',
  'case-dream': 'Loop Dream Carry Case',
  'pouch-link': 'Loop Link Pouch',
}

const SHORTHAND_PREFIXES = {
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
  // Don't strip "switch2-motorsport-exploration" — see TS mapping for why.
  switch2: ['switch2-clown', 'switch-2-clown'],
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripPng(name) {
  return name.replace(/\.(png|jpg|jpeg)$/i, '')
}

function deriveVariantSlug(innerFilename, productSlug) {
  const base = stripPng(innerFilename)
  const prefixes = new Set()
  prefixes.add(slugify(productSlug))
  if (PRODUCT_DISPLAY_NAMES[productSlug]) {
    prefixes.add(slugify(PRODUCT_DISPLAY_NAMES[productSlug]))
  }
  for (const p of SHORTHAND_PREFIXES[productSlug] ?? []) {
    prefixes.add(p)
  }
  let slug = slugify(base)
  const sorted = Array.from(prefixes)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const p of sorted) {
    if (slug === p) {
      slug = ''
      break
    }
    if (slug.startsWith(`${p}-`)) {
      slug = slug.slice(p.length + 1)
      break
    }
  }
  if (!slug) return 'default'
  if (/^\d+$/.test(slug)) return `v${slug}`
  slug = slug.replace(/^motorsport-exploration-/, 'motorsport-')
  return slug
}

function deriveLabel(innerFilename) {
  return stripPng(innerFilename).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function clownStoragePath(productSlug, variantSlug, ext) {
  return `cmf/clowns/${productSlug}/${variantSlug}.${ext}`
}

// ─── clients ──────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const prisma = new PrismaClient()
const BUCKET = 'generated-images'

// ─── runner ──────────────────────────────────────────────────────────────

console.log('\n=== CMF Clown Library Seed ===')
console.log(`Mode:       ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
console.log(`Overwrite:  ${OVERWRITE}`)
console.log(`Only:       ${ONLY ?? 'all'}`)
console.log(`Source:     ${SOURCE}`)
console.log('')

let zips
try {
  const entries = await fs.readdir(SOURCE)
  zips = entries.filter((n) => n.toLowerCase().endsWith('.zip')).sort()
} catch (err) {
  console.error(`Cannot read source folder: ${err?.message ?? err}`)
  process.exit(1)
}

if (zips.length === 0) {
  console.error(`No .zip files found in ${SOURCE}`)
  process.exit(1)
}

let totalUploaded = 0
let totalReplaced = 0
let totalSkipped = 0
let totalErrors = 0

for (const zipName of zips) {
  const stem = zipName.replace(/\.zip$/i, '').toLowerCase().trim()
  const productSlug = ZIP_TO_PRODUCT[stem]

  if (!productSlug) {
    console.log(`[skip] ${zipName} — not in canonical mapping`)
    totalSkipped += 1
    continue
  }
  if (ONLY && productSlug !== ONLY) {
    console.log(`[skip] ${zipName} — filtered out by --only=${ONLY}`)
    totalSkipped += 1
    continue
  }

  console.log(`\n[zip]  ${zipName} -> product "${productSlug}"`)

  let zip
  try {
    const buffer = await fs.readFile(path.join(SOURCE, zipName))
    zip = await JSZip.loadAsync(buffer)
  } catch (err) {
    console.error(`  [error] cannot open zip: ${err?.message ?? err}`)
    totalErrors += 1
    continue
  }

  const entries = Object.values(zip.files).filter(
    (e) => !e.dir && /\.(png|jpe?g)$/i.test(e.name)
  )

  for (const entry of entries) {
    const inner = entry.name.split('/').pop() ?? entry.name
    const variantSlug = deriveVariantSlug(inner, productSlug)
    const label = deriveLabel(inner)
    const ext = /\.png$/i.test(inner) ? 'png' : 'jpg'
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
    const storagePath = clownStoragePath(productSlug, variantSlug, ext)

    // In dry-run we don't need a DB round-trip — we just want to print the
    // mapping. This also keeps the script useful before the migration runs.
    let existing = null
    if (!DRY_RUN) {
      existing = await prisma.cmfClownAsset.findUnique({
        where: { productSlug_variantSlug: { productSlug, variantSlug } },
        select: { id: true },
      })
      if (existing && !OVERWRITE) {
        console.log(
          `  [skip] ${inner} -> ${productSlug}/${variantSlug} (exists; pass --overwrite to replace)`
        )
        totalSkipped += 1
        continue
      }
    }

    if (DRY_RUN) {
      console.log(
        `  [dry]  would upload ${inner} -> ${productSlug}/${variantSlug} (${storagePath})`
      )
      totalUploaded += 1
      continue
    }

    try {
      const bytes = await entry.async('nodebuffer')
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, bytes, {
          contentType: mime,
          upsert: true,
          cacheControl: 'public, max-age=31536000, immutable',
        })
      if (storageError) {
        throw new Error(`storage upload failed: ${storageError.message}`)
      }
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath)
      const publicUrl = publicUrlData.publicUrl

      await prisma.cmfClownAsset.upsert({
        where: { productSlug_variantSlug: { productSlug, variantSlug } },
        create: {
          ownerId: null,
          productSlug,
          variantSlug,
          label,
          imageUrl: publicUrl,
          storagePath,
          components: [],
        },
        update: {
          label,
          imageUrl: publicUrl,
          storagePath,
        },
      })

      if (existing) {
        console.log(`  [ok]   replaced ${inner} -> ${productSlug}/${variantSlug}`)
        totalReplaced += 1
      } else {
        console.log(`  [ok]   uploaded ${inner} -> ${productSlug}/${variantSlug}`)
        totalUploaded += 1
      }
    } catch (err) {
      console.error(`  [error] ${inner} -> ${productSlug}/${variantSlug}: ${err?.message ?? err}`)
      totalErrors += 1
    }
  }
}

console.log('\n=== Summary ===')
console.log(`Uploaded: ${totalUploaded}`)
console.log(`Replaced: ${totalReplaced}`)
console.log(`Skipped:  ${totalSkipped}`)
console.log(`Errors:   ${totalErrors}`)

await prisma.$disconnect()
process.exit(totalErrors > 0 ? 1 : 0)
