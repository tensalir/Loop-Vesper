#!/usr/bin/env node
/**
 * Files a product's photographs into the product render library from a manifest.
 *
 *   node --env-file=.env scripts/import-product-photos.mjs scripts/renders/live-pro.json --from "<folder>"
 *   node --env-file=.env scripts/import-product-photos.mjs scripts/renders/live-pro.json --from "<folder>" --apply
 *   node --env-file=.env scripts/import-product-photos.mjs scripts/renders/live-pro.json --from "<folder>" --preview <dir>
 *
 * Without --apply it is a dry run: it reads every file, says what it would upload
 * and which rows it would create, update or rename, and writes nothing.
 *
 * The manifest names the product, each picture (its file under --from, colourway,
 * angle, render type and order) and any existing rows to move under the product:
 *
 *   { "product": "Live Pro",
 *     "updates": [{ "where": { "name": "Aphrodite" }, "set": { "name": "Live Pro", "renderType": "pair" } }],
 *     "items": [{ "file": "NEW PRODUCT/DSC04920.jpg", "colorway": "Iridescent", "angle": "closed",
 *                 "renderType": "case" }] }
 *
 * Camera originals (7008 px, 12 MB) are resized to 2048 px on the long edge as a
 * JPEG at quality 90 before upload, the size the other renders are drawn at. A
 * studio shot on a plain light background (the manifest's `crop.renderTypes`) is
 * first cropped to the product with a margin, so that a model given it as a
 * reference gets the product's detail rather than a small object on white. A
 * photograph of the product worn is never cropped. `--preview <dir>` writes the
 * pictures exactly as they would be uploaded, for a look before `--apply`. The
 * storage path is derived from the product, colourway, type, angle and file name,
 * so a re-run updates the same rows instead of adding copies.
 *
 * Env: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Written 2026-10-02 for the Live Pro photographs.
 */

import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import fs from 'fs/promises'
import path from 'path'

const BUCKET = 'product-renders'
const LONG_EDGE = 2048
const RENDER_TYPES = ['single', 'pair', 'case', 'packaging', 'in-ear'] // src/lib/product-renders/types.ts

const args = process.argv.slice(2)
const manifestPath = args.find((a) => !a.startsWith('--'))
const fromIdx = args.indexOf('--from')
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : null
const APPLY = args.includes('--apply')
const previewIdx = args.indexOf('--preview')
const PREVIEW = previewIdx >= 0 ? args[previewIdx + 1] : null

if (!manifestPath || !FROM) {
  console.error('Usage: node --env-file=.env scripts/import-product-photos.mjs <manifest.json> --from <folder> [--apply]')
  process.exit(1)
}

const slug = (s) => String(s || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
const product = manifest.product
if (!product || !Array.isArray(manifest.items) || manifest.items.length === 0) {
  console.error('The manifest needs a product and at least one item.')
  process.exit(1)
}

// Check everything before touching storage or the database.
const problems = []
const order = new Map()
const plan = []
for (const item of manifest.items) {
  if (!RENDER_TYPES.includes(item.renderType)) problems.push(`${item.file}: render type ${item.renderType} is not one of ${RENDER_TYPES.join(', ')}`)
  const file = path.join(FROM, item.file)
  try {
    await fs.access(file)
  } catch {
    problems.push(`${item.file}: not found under ${FROM}`)
    continue
  }
  const key = item.colorway || 'Default'
  const sortOrder = item.sortOrder ?? (order.get(key) ?? 0)
  order.set(key, sortOrder + 1)
  const stem = path.basename(item.file, path.extname(item.file)).toLowerCase()
  const storagePath = `products/${slug(product)}/${slug(item.colorway)}/${item.renderType}-${slug(item.angle)}-${stem}.jpg`
  plan.push({ item, file, sortOrder, storagePath })
}
if (problems.length) {
  console.error('Refused, nothing written:\n  ' + problems.join('\n  '))
  process.exit(1)
}

const CROP_TYPES = manifest.crop?.renderTypes ?? []
const CROP_MARGIN = manifest.crop?.margin ?? 0.15
const SUBJECT_LUMA = manifest.crop?.subjectLuma ?? 170 // darker than this is the product, lighter is the table and its shadow

/** The product's box in the original: the darker pixels of a small copy, with a margin, clamped to the frame. */
async function subjectBox(file) {
  const meta = await sharp(file).rotate().metadata()
  const W = meta.autoOrient?.width ?? meta.width
  const H = meta.autoOrient?.height ?? meta.height
  const small = await sharp(file).rotate().resize({ width: 600, height: 600, fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = small.info
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (small.data[y * w + x] < SUBJECT_LUMA) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const sx = W / w, sy = H / h
  const bw = (x1 - x0 + 1) * sx, bh = (y1 - y0 + 1) * sy
  const m = CROP_MARGIN * Math.max(bw, bh)
  const left = Math.max(0, Math.floor(x0 * sx - m))
  const top = Math.max(0, Math.floor(y0 * sy - m))
  const right = Math.min(W, Math.ceil((x1 + 1) * sx + m))
  const bottom = Math.min(H, Math.ceil((y1 + 1) * sy + m))
  return { left, top, width: right - left, height: bottom - top }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const prisma = new PrismaClient()

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${plan.length} picture(s) for ${product}`)

for (const u of manifest.updates || []) {
  const rows = await prisma.productRender.findMany({ where: u.where, select: { id: true, name: true, colorway: true, renderType: true } })
  for (const r of rows) {
    console.log(`  update ${r.id.slice(0, 8)} ${r.name} / ${r.colorway ?? '-'} / ${r.renderType ?? '-'} -> ${JSON.stringify(u.set)}`)
    if (APPLY) await prisma.productRender.update({ where: { id: r.id }, data: u.set })
  }
  if (rows.length === 0) console.log(`  update: no row matches ${JSON.stringify(u.where)}`)
}

let created = 0
let updated = 0
for (const { item, file, sortOrder, storagePath } of plan) {
  const box = CROP_TYPES.includes(item.renderType) ? await subjectBox(file) : null
  let img = sharp(file).rotate()
  if (box) img = sharp(await img.extract(box).toBuffer())
  const out = await img
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  const existing = await prisma.productRender.findFirst({ where: { storagePath }, select: { id: true } })
  const data = {
    name: product,
    colorway: item.colorway || null,
    angle: item.angle || null,
    renderType: item.renderType,
    sortOrder,
    storagePath,
    source: 'local',
  }
  const what = existing ? 'update' : 'create'
  console.log(`  ${what}${box ? ' (cropped)' : ''} ${item.renderType.padEnd(9)} ${String(item.colorway).padEnd(22)} ${String(item.angle).padEnd(34)} ${out.info.width}x${out.info.height} ${(out.data.length / 1024).toFixed(0)} KB  ${storagePath}`)
  if (PREVIEW) {
    await fs.mkdir(PREVIEW, { recursive: true })
    await fs.writeFile(path.join(PREVIEW, storagePath.split('/').slice(2).join('__')), out.data)
  }
  if (!APPLY) continue
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, out.data, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`${storagePath}: ${error.message}`)
  const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
  if (existing) {
    await prisma.productRender.update({ where: { id: existing.id }, data: { ...data, imageUrl } })
    updated++
  } else {
    await prisma.productRender.create({ data: { ...data, imageUrl } })
    created++
  }
}

console.log(APPLY ? `Done: ${created} created, ${updated} updated.` : 'Dry run: nothing written. Add --apply to write.')
await prisma.$disconnect()
