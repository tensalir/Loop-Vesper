import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { CMF_STORAGE_BUCKET, importStoragePath } from '@/lib/cmf/storage'
import { getFlatRawRows, parseCmfWorkbook, XlsxParseError } from '@/lib/cmf/xlsx'
import {
  normaliseParsedSheets,
  normaliseRawRows,
  type NormalizationResult,
} from '@/lib/cmf/schema'
import {
  createPacketFromRows,
  logCmfActivity,
  requireCmfWrite,
} from '@/lib/cmf/service'
import { cmfError } from '@/lib/cmf/api'
import { getCmfProduct } from '@/lib/cmf/products'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

const cmfImportLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 })
const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * POST /api/cmf/import
 *
 * Multipart form data:
 *   - file: .xlsx workbook (required)
 *   - packetName, cmfCode, notes (optional)
 *   - createPacket=true to immediately materialise an editable packet
 *
 * Accepts both the transposed CMF schema (one tab per product, columns as
 * SKUs) and the legacy flat template (single sheet, rows as SKUs).
 */
export async function POST(request: NextRequest) {
  // Imports mutate the global library — gate on CMF write access.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const limited = cmfImportLimiter.check(auth.profile.userId)
  if (limited) return limited

  let file: File | null = null
  let packetName: string | undefined
  let cmfCode: string | undefined
  let notes: string | undefined
  let createPacket = false
  try {
    const formData = await request.formData()
    file = formData.get('file') as File | null
    packetName = (formData.get('packetName') as string | null) || undefined
    cmfCode = (formData.get('cmfCode') as string | null) || undefined
    notes = (formData.get('notes') as string | null) || undefined
    createPacket = (formData.get('createPacket') as string | null) === 'true'
  } catch {
    return cmfError('Invalid multipart body')
  }

  if (!file) {
    return cmfError('file is required')
  }
  if (file.size > MAX_WORKBOOK_BYTES) {
    return cmfError(
      `Workbook too large (max ${MAX_WORKBOOK_BYTES / (1024 * 1024)} MB)`,
      { status: 413 }
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  let parsed: ReturnType<typeof parseCmfWorkbook>
  try {
    parsed = parseCmfWorkbook(buffer)
  } catch (err) {
    if (err instanceof XlsxParseError) {
      return cmfError(err.message)
    }
    throw err
  }

  // Route to the right normaliser. The transposed format keeps rich sheet
  // metadata (collection, groups) we want to thread into the import record.
  let normalised: NormalizationResult
  let parsedRowsForRecord: unknown
  if (parsed.format === 'transposed') {
    normalised = normaliseParsedSheets(parsed.sheets)
    parsedRowsForRecord = {
      format: 'transposed',
      sheets: parsed.sheets,
      unmappedSheets: parsed.unmappedSheets,
    }
  } else {
    const rawRows = getFlatRawRows(buffer)
    normalised = normaliseRawRows(rawRows)
    parsedRowsForRecord = {
      format: 'flat',
      rows: normalised.rows,
    }
  }

  const importRecord = await prisma.cmfImport.create({
    data: {
      ownerId: auth.profile.userId,
      fileName: file.name,
      rawRows:
        parsed.format === 'transposed'
          ? ({ sheets: parsed.sheets.map((s) => ({ sheetName: s.sheetName, skuCount: s.skus.length })) } as object)
          : ({ rows: getFlatRawRows(buffer) } as object),
      parsedRows: parsedRowsForRecord as object,
      status: normalised.errors.length > 0 ? 'failed' : 'validated',
      errors: normalised.errors.length > 0 ? (normalised.errors as unknown as object) : undefined,
      rowCount: normalised.rows.length,
    },
  })

  // Upload the original .xlsx for traceability. Best-effort.
  try {
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString('base64')}`
    const path = importStoragePath(auth.profile.userId, importRecord.id)
    await uploadBase64ToStorage(dataUrl, CMF_STORAGE_BUCKET, path)
    await prisma.cmfImport.update({
      where: { id: importRecord.id },
      data: { storagePath: path },
    })
  } catch (err) {
    console.warn('[cmf/import] storage upload failed', err)
  }

  if (!createPacket || normalised.rows.length === 0) {
    return NextResponse.json({
      import: {
        id: importRecord.id,
        status: importRecord.status,
        errors: normalised.errors,
        rowCount: importRecord.rowCount,
        parsedRows: normalised.rows,
        format: parsed.format,
        unmappedSheets: parsed.format === 'transposed' ? parsed.unmappedSheets : [],
        // Diagnostics from the parser. Only populated for the transposed
        // format — the flat fallback has no concept of multi-tab layouts
        // or per-SKU column drops, so we send empty arrays for shape
        // compatibility on the client.
        unrecognisedSheets:
          parsed.format === 'transposed' ? parsed.unrecognisedSheets : [],
        droppedSkuColumns:
          parsed.format === 'transposed' ? parsed.droppedSkuColumns : [],
        unknownAttributeRows:
          parsed.format === 'transposed' ? parsed.unknownAttributeRows : [],
      },
    })
  }

  const { packets } = await createPacketFromRows({
    ownerId: auth.profile.userId,
    importId: importRecord.id,
    packetName,
    cmfCode,
    notes,
    rows: normalised.rows,
  })

  // Log one workbook-import event per packet so the activity timeline on
  // each product packet shows where its SKUs came from. We log on every
  // packet (not just the primary) so a designer scrolling the Eclipse
  // packet sees the import even when the Cocoon packet is "primary".
  for (const { packet } of packets) {
    await logCmfActivity({
      packetId: packet.id,
      userId: auth.profile.userId,
      action: 'imported_workbook',
      targetId: importRecord.id,
      metadata: {
        fileName: file.name,
        rows: normalised.rows.length,
        errors: normalised.errors.length,
        format: parsed.format,
      },
    })
  }

  // Pick the largest packet as the "primary" one — that's almost always the
  // one the designer wants to open first. Falls back to first-by-creation.
  const primary = packets.reduce(
    (best, current) => (current.renders.length > best.renders.length ? current : best),
    packets[0]
  )

  return NextResponse.json({
    import: {
      id: importRecord.id,
      status: importRecord.status,
      errors: normalised.errors,
      rowCount: importRecord.rowCount,
      format: parsed.format,
      unmappedSheets: parsed.format === 'transposed' ? parsed.unmappedSheets : [],
      // Same diagnostics as the early-return branch above. We send them
      // even on a successful import because partial successes (some
      // tabs imported, some silently dropped) used to leave designers
      // wondering why the result didn't match the workbook.
      unrecognisedSheets:
        parsed.format === 'transposed' ? parsed.unrecognisedSheets : [],
      droppedSkuColumns:
        parsed.format === 'transposed' ? parsed.droppedSkuColumns : [],
      unknownAttributeRows:
        parsed.format === 'transposed' ? parsed.unknownAttributeRows : [],
    },
    /** All packets created or merged by this import — one per product
     * slug. Each entry carries `productName` so the UI can say
     * "Updated 2 product packets: Switch 2, Cocoon" without re-deriving
     * the display name from the slug, and `mergeSummary` so the panel
     * can show a "5 unchanged · 1 changed · 2 added" breakdown. */
    packets: packets.map(({ packet, renders, mergeSummary }) => {
      const productSlug = renders[0]?.productSlug ?? mergeSummary.productSlug
      const productName = productSlug ? getCmfProduct(productSlug)?.name ?? null : null
      return {
        id: packet.id,
        name: packet.name,
        cmfCode: packet.cmfCode,
        status: packet.status,
        productSlug,
        productName,
        renderCount: renders.length,
        mergeSummary,
      }
    }),
    /** Convenience: the packet the workspace should auto-open. */
    packet: primary
      ? {
          id: primary.packet.id,
          name: primary.packet.name,
          cmfCode: primary.packet.cmfCode,
          status: primary.packet.status,
          renders: primary.renders.map((r) => ({
            id: r.id,
            label: r.label,
            status: r.status,
            productSlug: r.productSlug,
          })),
        }
      : null,
  })
}
