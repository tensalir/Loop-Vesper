import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { CMF_STORAGE_BUCKET, importStoragePath } from '@/lib/cmf/storage'
import { parseCmfWorkbook, XlsxParseError } from '@/lib/cmf/xlsx'
import { normaliseRawRows } from '@/lib/cmf/schema'
import {
  createPacketFromRows,
  requireAuthenticatedProfile,
} from '@/lib/cmf/service'
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
 * Response:
 *   - import: {id, status, errors, parsedRows}
 *   - packet (if createPacket=true): {id, name, renders: [...]}
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
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
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_WORKBOOK_BYTES) {
    return NextResponse.json(
      { error: `Workbook too large (max ${MAX_WORKBOOK_BYTES / (1024 * 1024)} MB)` },
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
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const normalised = normaliseRawRows(parsed.rows)

  // Persist the import record. We always store the raw rows so designers can
  // re-validate after we evolve the schema, and the parsed rows for fast
  // packet creation.
  const importRecord = await prisma.cmfImport.create({
    data: {
      ownerId: auth.profile.userId,
      fileName: file.name,
      rawRows: parsed.rows as unknown as object,
      parsedRows: normalised.rows as unknown as object,
      status: normalised.errors.length > 0 ? 'failed' : 'validated',
      errors: normalised.errors.length > 0 ? (normalised.errors as unknown as object) : undefined,
      rowCount: normalised.rows.length,
    },
  })

  // Upload the original .xlsx for traceability. Best-effort — never block
  // the API call on the upload.
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
      },
    })
  }

  // Immediately build a packet so the designer goes straight to render setup.
  const { packet, renders } = await createPacketFromRows({
    ownerId: auth.profile.userId,
    importId: importRecord.id,
    packetName,
    cmfCode,
    notes,
    rows: normalised.rows,
  })

  return NextResponse.json({
    import: {
      id: importRecord.id,
      status: importRecord.status,
      errors: normalised.errors,
      rowCount: importRecord.rowCount,
    },
    packet: {
      id: packet.id,
      name: packet.name,
      cmfCode: packet.cmfCode,
      status: packet.status,
      renders: renders.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        productSlug: r.productSlug,
      })),
    },
  })
}
