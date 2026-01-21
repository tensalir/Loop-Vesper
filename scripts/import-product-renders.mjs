#!/usr/bin/env node
/**
 * Product Renders Import Script
 * 
 * Imports product render images from specified OneDrive folders into Supabase Storage
 * and creates corresponding database records.
 * 
 * Usage:
 *   node scripts/import-product-renders.mjs [options]
 * 
 * Options:
 *   --dry-run       Preview what would be imported without making changes
 *   --limit N       Only process first N images
 *   --only <name>   Only process specific folder (engage2, experience2, quiet2, switch2, flat)
 *   --overwrite     Re-upload and update existing records
 * 
 * Environment variables required:
 *   DATABASE_URL              Postgres connection string
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Supabase service role key
 */

import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// Load .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '..', '.env.local')

try {
  const envContent = await fs.readFile(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...valueParts] = trimmed.split('=')
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '')
    }
  }
} catch (e) {
  console.log('Could not load .env.local, trying .env')
  try {
    const envContent = await fs.readFile(path.resolve(__dirname, '..', '.env'), 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch (e2) {
    console.error('Warning: Could not load environment files')
  }
}

// Parse command line args
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const OVERWRITE = args.includes('--overwrite')
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1]?.toLowerCase() : null

console.log('\n=== Product Renders Import Script ===')
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`)
console.log(`Overwrite: ${OVERWRITE}`)
console.log(`Limit: ${LIMIT === Infinity ? 'none' : LIMIT}`)
console.log(`Only: ${ONLY || 'all'}\n`)

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const prisma = new PrismaClient()
const BUCKET = 'product-renders'

// Check if database schema is up to date
async function checkDatabaseSchema() {
  try {
    // Try a simple query that uses the renderType field
    await prisma.$queryRaw`SELECT render_type FROM product_renders LIMIT 1`
    return true
  } catch (error) {
    if (error.message?.includes('render_type') || error.message?.includes('does not exist')) {
      console.error('\n*** DATABASE MIGRATION REQUIRED ***')
      console.error('The render_type column does not exist in the database.')
      console.error('Please run the following commands first:')
      console.error('  npx prisma generate')
      console.error('  npx prisma migrate deploy')
      console.error('\nOr apply the migration manually from:')
      console.error('  prisma/migrations/20260121_add_product_render_type/migration.sql\n')
      return false
    }
    // Other errors, let it continue
    return true
  }
}

// ============================================================================
// Source Folder Definitions
// ============================================================================

const FLAT_FOLDER = 'C:\\Users\\buyss\\OneDrive - Loop\\Creative Technology\\01_Admin\\01_Branding\\Loop Product Renders'

const MERCURY_FOLDERS = {
  engage2: 'C:\\Users\\buyss\\OneDrive - Loop\\Creative Technology\\04_Projects\\00_Marketing Lab - Mercury\\03_Creation\\01_Product Renders\\Engage 2',
  experience2: 'C:\\Users\\buyss\\OneDrive - Loop\\Creative Technology\\04_Projects\\00_Marketing Lab - Mercury\\03_Creation\\01_Product Renders\\Experience 2',
  quiet2: 'C:\\Users\\buyss\\OneDrive - Loop\\Creative Technology\\04_Projects\\00_Marketing Lab - Mercury\\03_Creation\\01_Product Renders\\Quiet 2',
  switch2: 'C:\\Users\\buyss\\OneDrive - Loop\\Creative Technology\\04_Projects\\00_Marketing Lab - Mercury\\03_Creation\\01_Product Renders\\Switch 2',
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Slugify a string for use in file paths */
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Extract file extension */
function getExtension(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1)
  return ['png', 'jpg', 'jpeg'].includes(ext) ? ext : null
}

/** Normalize product name (remove Loop_ prefix, replace _ with space) */
function normalizeProductName(name) {
  return name
    .replace(/^Loop[_\s]*/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract sort order from filename (e.g., "..._3.png" -> 3) */
function extractSortOrder(filename) {
  const match = filename.match(/[_\s](\d+)\.[a-z]+$/i)
  return match ? parseInt(match[1], 10) : 0
}

/** Parse flat folder filename into metadata */
function parseFlatFilename(filename) {
  // Examples:
  // - Quiet_2_Mint_Pair_1.png -> { product: "Quiet 2", colorway: "Mint", renderType: "pair", sortOrder: 1 }
  // - Case_Black_open 1.png -> { product: "Dream", colorway: "Black", renderType: "case", angle: "open", sortOrder: 1 }
  // - Experience_2_Silver_Single_1.png -> { product: "Experience 2", colorway: "Silver", renderType: "single", sortOrder: 1 }
  
  const ext = getExtension(filename)
  if (!ext) return null
  
  const baseName = path.basename(filename, `.${ext}`)
  const parts = baseName.replace(/[\s_]+/g, '_').split('_').filter(Boolean)
  
  // Check if it's a Case (Dream carry case)
  if (parts[0]?.toLowerCase() === 'case') {
    // Case_Black_open 1.png -> parts: ['Case', 'Black', 'open', '1']
    const colorway = parts[1] || 'Default'
    const anglePart = parts[2]?.toLowerCase()
    const sortOrder = extractSortOrder(filename)
    const angle = anglePart === 'open' || anglePart === 'close' || anglePart === 'closed' ? anglePart : null
    
    return {
      product: 'Dream',
      colorway: normalizeProductName(colorway),
      renderType: 'case',
      angle: angle,
      sortOrder,
    }
  }
  
  // Check for product patterns like Quiet_2_Mint_Single_1 or Switch_2_Black_Pair_2
  // Pattern: <Product>_<2?>_<Colorway>_<Single|Pair>_<N>
  let product = null
  let colorway = null
  let renderType = null
  let sortOrder = extractSortOrder(filename)
  
  // Find Single or Pair in parts
  const typeIdx = parts.findIndex(p => /^(single|pair)$/i.test(p))
  if (typeIdx > 0) {
    renderType = parts[typeIdx].toLowerCase()
    
    // Everything before renderType (except the last part which is colorway)
    const beforeType = parts.slice(0, typeIdx)
    colorway = beforeType.pop() || 'Default'
    product = normalizeProductName(beforeType.join(' '))
    
    return {
      product,
      colorway: normalizeProductName(colorway),
      renderType,
      angle: null,
      sortOrder,
    }
  }
  
  // Also handle case patterns like "Experience_case_open 1.png" or "Quiet_case_close 1.png"
  const caseIdx = parts.findIndex(p => /^case$/i.test(p))
  if (caseIdx > 0) {
    const productParts = parts.slice(0, caseIdx)
    product = normalizeProductName(productParts.join(' '))
    const anglePart = parts[caseIdx + 1]?.toLowerCase()
    const angle = anglePart === 'open' || anglePart === 'close' || anglePart === 'closed' ? anglePart : null
    
    return {
      product,
      colorway: 'Default',
      renderType: 'case',
      angle,
      sortOrder,
    }
  }
  
  return null // Unrecognized pattern
}

/** Parse Mercury folder structure into metadata */
function parseMercuryPath(productRoot, colorwayFolder, typeFolder, filename) {
  // productRoot: "Engage 2", "Experience 2", etc.
  // colorwayFolder: "Clear", "Rose", "Black", etc.
  // typeFolder: "Single", "Pair", "Pairs", "Carry Case"
  // filename: "Engage_2_Clear_Pair_1.png"
  
  const ext = getExtension(filename)
  if (!ext) return null
  
  const product = normalizeProductName(productRoot)
  const colorway = normalizeProductName(colorwayFolder)
  
  let renderType = null
  if (/^single$/i.test(typeFolder)) {
    renderType = 'single'
  } else if (/^pairs?$/i.test(typeFolder)) {
    renderType = 'pair'
  } else if (/^carry\s*case$/i.test(typeFolder)) {
    renderType = 'case'
  }
  
  const sortOrder = extractSortOrder(filename)
  
  // Try to extract angle from filename for cases
  let angle = null
  if (renderType === 'case') {
    const baseName = path.basename(filename, `.${ext}`).toLowerCase()
    if (baseName.includes('open')) angle = 'open'
    else if (baseName.includes('close')) angle = 'closed'
  }
  
  return {
    product,
    colorway,
    renderType,
    angle,
    sortOrder,
  }
}

// ============================================================================
// Scanning Functions
// ============================================================================

/** Check if a path exists and is a directory */
async function isDirectory(p) {
  try {
    const stat = await fs.stat(p)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/** Scan the flat folder for relevant images */
async function scanFlatFolder() {
  const images = []
  
  if (!await isDirectory(FLAT_FOLDER)) {
    console.warn(`Warning: Flat folder not found: ${FLAT_FOLDER}`)
    return images
  }
  
  const files = await fs.readdir(FLAT_FOLDER)
  
  for (const file of files) {
    const ext = getExtension(file)
    if (!ext) continue
    
    const parsed = parseFlatFilename(file)
    if (!parsed) {
      console.log(`  Skipping unrecognized: ${file}`)
      continue
    }
    
    images.push({
      sourcePath: path.join(FLAT_FOLDER, file),
      filename: file,
      ...parsed,
    })
  }
  
  return images
}

/** Scan a Mercury product folder for relevant images */
async function scanMercuryFolder(productName, productPath) {
  const images = []
  
  if (!await isDirectory(productPath)) {
    console.warn(`Warning: Mercury folder not found: ${productPath}`)
    return images
  }
  
  // List colorway folders
  const colorwayFolders = await fs.readdir(productPath)
  
  for (const colorwayFolder of colorwayFolders) {
    const colorwayPath = path.join(productPath, colorwayFolder)
    if (!await isDirectory(colorwayPath)) continue
    
    // Skip non-colorway folders (like "Sublime - ...")
    if (colorwayFolder.toLowerCase().startsWith('sublime')) continue
    
    // Scan for Single, Pair, Pairs, Carry Case subfolders
    const typeFolders = ['Single', 'Pair', 'Pairs', 'Carry Case']
    
    for (const typeFolder of typeFolders) {
      const typePath = path.join(colorwayPath, typeFolder)
      if (!await isDirectory(typePath)) continue
      
      const files = await fs.readdir(typePath)
      
      for (const file of files) {
        const ext = getExtension(file)
        if (!ext) continue
        
        const parsed = parseMercuryPath(productName, colorwayFolder, typeFolder, file)
        if (!parsed || !parsed.renderType) continue
        
        images.push({
          sourcePath: path.join(typePath, file),
          filename: file,
          ...parsed,
        })
      }
    }
  }
  
  return images
}

// ============================================================================
// Import Functions
// ============================================================================

/** Generate a stable storage path for an image */
function getStoragePath(image) {
  const productSlug = slugify(image.product)
  const colorwaySlug = slugify(image.colorway)
  const typeSlug = image.renderType
  const anglePart = image.angle ? `-${slugify(image.angle)}` : ''
  const sortPart = image.sortOrder > 0 ? `-${image.sortOrder}` : ''
  const ext = getExtension(image.filename) || 'png'
  
  return `products/${productSlug}/${colorwaySlug}/${typeSlug}${anglePart}${sortPart}.${ext}`
}

/** Check if a render already exists in the database */
async function findExistingRender(storagePath) {
  try {
    return await prisma.productRender.findFirst({
      where: { storagePath },
      select: { id: true, storagePath: true, imageUrl: true },
    })
  } catch (error) {
    // If there's a schema mismatch, fall back to checking by ID
    console.warn('Warning: Could not query by storagePath, migration may be pending')
    return null
  }
}

/** Upload a file to Supabase storage */
async function uploadToStorage(sourcePath, storagePath) {
  const fileBuffer = await fs.readFile(sourcePath)
  const ext = path.extname(storagePath).slice(1)
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
  
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    })
  
  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`)
  }
  
  // Get public URL
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  return urlData.publicUrl
}

/** Import a single image */
async function importImage(image) {
  const storagePath = getStoragePath(image)
  
  // Check for existing record
  const existing = await findExistingRender(storagePath)
  
  if (existing && !OVERWRITE) {
    return { status: 'skipped', reason: 'exists', storagePath }
  }
  
  if (DRY_RUN) {
    return { status: 'dry-run', storagePath, image }
  }
  
  try {
    // Upload to storage
    const imageUrl = await uploadToStorage(image.sourcePath, storagePath)
    
    if (existing) {
      // Update existing record
      await prisma.productRender.update({
        where: { id: existing.id },
        data: {
          name: image.product,
          colorway: image.colorway,
          renderType: image.renderType,
          angle: image.angle,
          sortOrder: image.sortOrder,
          imageUrl,
        },
      })
      return { status: 'updated', storagePath }
    } else {
      // Create new record
      await prisma.productRender.create({
        data: {
          name: image.product,
          colorway: image.colorway,
          renderType: image.renderType,
          angle: image.angle,
          sortOrder: image.sortOrder,
          imageUrl,
          storagePath,
          source: 'local',
        },
      })
      return { status: 'created', storagePath }
    }
  } catch (error) {
    return { status: 'error', error: error.message, storagePath }
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  // Check database schema first (skip in dry-run mode since we won't write anyway)
  if (!DRY_RUN) {
    const schemaOk = await checkDatabaseSchema()
    if (!schemaOk) {
      await prisma.$disconnect()
      process.exit(1)
    }
  }
  
  let allImages = []
  
  // Scan flat folder
  if (!ONLY || ONLY === 'flat') {
    console.log('Scanning flat folder...')
    const flatImages = await scanFlatFolder()
    console.log(`  Found ${flatImages.length} images`)
    allImages.push(...flatImages)
  }
  
  // Scan Mercury folders
  for (const [key, folderPath] of Object.entries(MERCURY_FOLDERS)) {
    if (ONLY && ONLY !== key) continue
    
    const productName = path.basename(folderPath)
    console.log(`Scanning ${productName}...`)
    const mercuryImages = await scanMercuryFolder(productName, folderPath)
    console.log(`  Found ${mercuryImages.length} images`)
    allImages.push(...mercuryImages)
  }
  
  // Apply limit
  if (LIMIT < allImages.length) {
    console.log(`\nLimiting to first ${LIMIT} images`)
    allImages = allImages.slice(0, LIMIT)
  }
  
  console.log(`\nTotal images to process: ${allImages.length}`)
  
  // Summary by product/colorway/type
  const summary = {}
  for (const img of allImages) {
    const key = `${img.product} / ${img.colorway} / ${img.renderType}`
    summary[key] = (summary[key] || 0) + 1
  }
  
  console.log('\n--- Summary ---')
  for (const [key, count] of Object.entries(summary).sort()) {
    console.log(`  ${key}: ${count}`)
  }
  
  if (allImages.length === 0) {
    console.log('\nNo images to import.')
    await prisma.$disconnect()
    return
  }
  
  // Import images
  console.log('\n--- Importing ---')
  const results = { created: 0, updated: 0, skipped: 0, errors: 0 }
  
  for (let i = 0; i < allImages.length; i++) {
    const image = allImages[i]
    const result = await importImage(image)
    
    if (result.status === 'created') {
      results.created++
      console.log(`[${i + 1}/${allImages.length}] Created: ${result.storagePath}`)
    } else if (result.status === 'updated') {
      results.updated++
      console.log(`[${i + 1}/${allImages.length}] Updated: ${result.storagePath}`)
    } else if (result.status === 'skipped') {
      results.skipped++
      if (i < 10 || (i + 1) % 50 === 0) {
        console.log(`[${i + 1}/${allImages.length}] Skipped (exists): ${result.storagePath}`)
      }
    } else if (result.status === 'dry-run') {
      results.created++
      console.log(`[${i + 1}/${allImages.length}] Would create: ${result.storagePath}`)
    } else if (result.status === 'error') {
      results.errors++
      console.error(`[${i + 1}/${allImages.length}] Error: ${result.error} - ${result.storagePath}`)
    }
  }
  
  // Final summary
  console.log('\n=== Results ===')
  console.log(`Created: ${results.created}`)
  console.log(`Updated: ${results.updated}`)
  console.log(`Skipped: ${results.skipped}`)
  console.log(`Errors: ${results.errors}`)
  
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
