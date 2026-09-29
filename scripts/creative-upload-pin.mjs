#!/usr/bin/env node
/**
 * Upload pinned references Vesper cannot fetch itself, from the machine that holds them.
 *
 *   node scripts/creative-upload-pin.mjs --kit <kit.json> --product packaging --pin white-closed --file <path>
 *   node scripts/creative-upload-pin.mjs --kit <kit.json> --product packaging --all --root <repo checkout>
 *   node scripts/creative-upload-pin.mjs --kit <kit.json> --product eclipse --pin <asset id> --file <original> --derived-only
 *
 * Why it exists. Packaging's references are Figma exports kept on the machine
 * that pulled them (pixels are never in git), so Vesper receives them from
 * here. And a pin too large for a model (the kit marks it `model_copy:
 * derived-4096`) needs a derived copy, which is made once, here, with the
 * repository's own resampling (qa.ensure_derived: Pillow, RGB, thumbnail to
 * 4096 px on the long edge, LANCZOS, PNG), never decoded in a Vesper function.
 *
 * What it does, per pin:
 *   1. hashes the file and refuses it unless the sha256 is the kit's;
 *   2. stores the bytes unchanged in the private bucket (pins/<sha256>.<ext>),
 *      unless --derived-only;
 *   3. for an oversized pin, makes the derived copy and stores it as
 *      pins/<sha256>@4096.png, with its recipe;
 *   4. records the pin in creative_pins as pending. The next pin sync (the
 *      admin route or the daily cron) checks it, previews it and uploads it
 *      to Gemini, and marks it ok.
 *
 * Env (read from the process, else from .env.local beside this repo; never
 * printed): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CREATIVE_PINS_BUCKET (default creative-pins). The derived copy needs
 * `python` with Pillow on the PATH (the plugin repository's own requirement).
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DERIVED_MAX_EDGE = 4096
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff' }

function args(argv) {
  const out = { all: false, derivedOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') out.all = true
    else if (a === '--derived-only') out.derivedOnly = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
  }
  return out
}

/** KEY=value lines only; values are never printed. */
function loadEnvLocal() {
  const path = resolve(HERE, '..', '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function die(message) {
  console.error(`  x ${message}`)
  process.exit(1)
}

/** The derived copy, exactly as the repository's qa.ensure_derived makes it. */
function derive(source, dest) {
  const code = [
    'import sys',
    'from PIL import Image',
    'src, dst, edge = sys.argv[1], sys.argv[2], int(sys.argv[3])',
    'limit = Image.MAX_IMAGE_PIXELS',
    'Image.MAX_IMAGE_PIXELS = None',
    'with Image.open(src) as im:',
    '    im.draft("RGB", (edge, edge))',
    '    im = im.convert("RGB")',
    '    im.thumbnail((edge, edge), Image.LANCZOS)',
    '    im.save(dst, "PNG", optimize=False)',
    'import PIL; print(PIL.__version__)',
  ].join('\n')
  const run = spawnSync(process.env.PYTHON || 'python', ['-c', code, source, dest, String(DERIVED_MAX_EDGE)], { encoding: 'utf8' })
  if (run.status !== 0) die(`the derived copy failed (python with Pillow is needed): ${(run.stderr || '').trim().slice(-300)}`)
  return run.stdout.trim()
}

async function main() {
  const a = args(process.argv.slice(2))
  if (!a.kit || !a.product) die('usage: --kit <kit.json> --product <slug> (--pin <id> --file <path> | --all --root <checkout>) [--derived-only]')
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  const bucket = process.env.CREATIVE_PINS_BUCKET || 'creative-pins'
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const kit = JSON.parse(readFileSync(resolve(a.kit), 'utf8'))
  const product = kit.products?.[a.product]
  if (!product) die(`the kit has no product ${a.product}; it has ${Object.keys(kit.products || {}).join(', ')}`)
  const maxPixels = product.grading?.max_model_pixels ?? 80_000_000
  const pins = product.references?.pins ?? []

  let jobs
  if (a.all) {
    if (!a.root) die('--all needs --root, the checkout whose local_path each pin names')
    jobs = pins.filter((p) => p.source === 'upload' && p.local_path).map((p) => ({ pin: p, file: resolve(a.root, p.local_path) }))
  } else {
    if (!a.pin || !a.file) die('name one pin with --pin and its file with --file, or use --all')
    const pin = pins.find((p) => p.id === a.pin)
    if (!pin) die(`${a.product} has no pin ${a.pin}`)
    jobs = [{ pin, file: resolve(a.file) }]
  }

  let failures = 0
  for (const { pin, file } of jobs) {
    const label = `${a.product}/${pin.id}`
    if (!pin.sha256) {
      console.error(`  - ${label}: the kit gives no sha256, so it cannot be pinned`)
      failures++
      continue
    }
    if (!existsSync(file)) {
      console.error(`  - ${label}: no file at ${file}`)
      failures++
      continue
    }
    const bytes = readFileSync(file)
    const digest = sha256(bytes)
    if (digest !== pin.sha256) {
      console.error(`  - ${label}: sha256 ${digest.slice(0, 12)}... is not the kit's ${pin.sha256.slice(0, 12)}...; not uploaded`)
      failures++
      continue
    }
    const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
    const row = { product: a.product, pin_id: pin.id, source: pin.source, title: pin.title ?? null, sha256: pin.sha256, status: 'pending', updated_at: new Date().toISOString() }

    if (!a.derivedOnly) {
      const path = `pins/${pin.sha256}${extname(file).toLowerCase() || '.bin'}`
      const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: true })
      if (error) die(`${label}: storing failed: ${error.message}`)
      Object.assign(row, { storage_path: path, mime, bytes: bytes.length, width: pin.width ?? null, height: pin.height ?? null })
    }

    const oversized = pin.model_copy === 'derived-4096' || (pin.width && pin.height && pin.width * pin.height > maxPixels)
    if (oversized) {
      const dir = mkdtempSync(join(tmpdir(), 'creative-pin-'))
      try {
        const dest = join(dir, 'derived.png')
        const pillow = derive(file, dest)
        const derived = readFileSync(dest)
        const path = `pins/${pin.sha256}@${DERIVED_MAX_EDGE}.png`
        const { error } = await supabase.storage.from(bucket).upload(path, derived, { contentType: 'image/png', upsert: true })
        if (error) die(`${label}: storing the derived copy failed: ${error.message}`)
        Object.assign(row, {
          derived_path: path,
          derived_sha256: sha256(derived),
          derived_recipe: { tool: 'Pillow', version: pillow, steps: 'convert RGB, thumbnail, LANCZOS, PNG', long_edge: DERIVED_MAX_EDGE, source_sha256: pin.sha256, mirrors: 'qa.ensure_derived' },
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const { error } = await supabase.from('creative_pins').upsert(row, { onConflict: 'pin_id,sha256' })
    if (error) die(`${label}: recording failed: ${error.message}`)
    console.log(`  ${label}: ${a.derivedOnly ? 'derived copy' : 'stored'}${oversized && !a.derivedOnly ? ' with its derived copy' : ''}; the next pin sync checks it and marks it ok`)
  }
  if (failures) process.exit(1)
}

main().catch((err) => die(err?.message || String(err)))
