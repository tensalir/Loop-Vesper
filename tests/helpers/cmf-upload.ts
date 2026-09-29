/**
 * A workbook upload and a product kit for the CMF tool tests, with no database, storage or model:
 * the committed Experience 2 CC spec as the upload's parse, the product repository's front key,
 * and the sample product kit with its CMF decider given a test email (the kit's deciders carry
 * none yet).
 */

import fs from 'fs'
import path from 'path'
import { expect } from '@playwright/test'
import { ProductKitSchema, type ProductKit } from '../../src/lib/creative/kit-schema'
import type { LoadedKit } from '../../src/lib/creative/kit'
import { cmfKit, CmfError, type CmfKit } from '../../src/lib/creative/cmf/kit-cmf'
import type { ClownKeyFile } from '../../src/lib/creative/cmf/prompt-fill'
import type { StoredWorkbook } from '../../src/lib/creative/cmf/workbook-source'
import type { Spec } from '../../src/lib/creative/cmf/spec-diff'
import type { WorkbookInfo } from '../../src/lib/creative/cmf/workbook'
import { McpProgressReporter } from '../../src/lib/headless/mcp-progress'
import type { ToolContext } from '../../src/lib/headless/tools/types'
import { MemoryJobStore } from './memory-job-store'
import { clone } from './cmf-supplier'

export const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'cmf', 'prompt-parity.json'), 'utf8'))
const KIT_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'creative', 'product-kit.v1.sample.json'), 'utf8'))
export const E2CC = FIX.specs['references/workbook/spec/experience-2-cc.json'] as Spec
export const KEY_ID = 'case-experience2--front'
export const FRONT = FIX.keys[KEY_ID] as ClownKeyFile
export const IMPORT = '11111111-2222-4333-8444-555555555555'
export const DECIDER = 'damien@loop.test'
export const UPLOAD_NAME = 'TML2027 CMF_Schema_All_Products.xlsx'

export type CommittedPayload = { column: string; prompt: string; prompt_sha256: string }
export const committedPayload = (column: string) => (FIX.payloads as CommittedPayload[]).find((p) => p.column === column)!

/** The sample product kit, its CMF decider given a test email; `edit` changes its CMF product first. */
export function kitWith(edit: (cmfProduct: any) => void = () => undefined): { kit: ProductKit; cmf: CmfKit; loaded: LoadedKit<ProductKit> } {
  const k = clone(KIT_JSON)
  const product = Object.values(k.products as Record<string, any>).find((p) => p.kind === 'cmf')
  product.deciders = product.deciders.map((d: any) => ({ ...d, email: DECIDER }))
  edit(product)
  const kit = ProductKitSchema.parse(k)
  const loaded: LoadedKit<ProductKit> = { kit, conformance: null as any, ref: 'product-design-v0.2.0', commit: 'd90c9bb', blobSha: 'blob', fetchedAt: new Date(), stale: false, staleReason: null }
  return { kit, cmf: cmfKit(kit), loaded }
}

/** The upload as loadStoredWorkbook returns it, its parse being `spec`. */
export function stored(spec: Spec): StoredWorkbook {
  const info: WorkbookInfo = { ...(spec.workbook as WorkbookInfo), file: UPLOAD_NAME }
  return {
    importId: IMPORT,
    ownerId: 'owner-1',
    fileName: UPLOAD_NAME,
    storagePath: `cmf/owner-1/imports/${IMPORT}.xlsx`,
    importedAt: '2026-09-22T09:20:41Z',
    info,
    specs: { [spec.tab]: { ...spec, workbook: info } },
  }
}

export function ctx(): ToolContext {
  return {
    principal: { credentialId: 'c', ownerId: 'damien', allowedTools: [], allowedModels: ['*'] },
    progress: new McpProgressReporter(),
    jobs: { store: new MemoryJobStore(), waitUntil: () => undefined },
    recordBackgroundUsage: async () => undefined,
    env: {} as unknown as NodeJS.ProcessEnv,
  }
}

/** The CmfError a promise rejects with. */
export async function refusalOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(CmfError)
    return err as Error
  }
  throw new Error('expected a refusal')
}

/** The message of any error a promise rejects with. */
export async function refusalText(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected a refusal')
}
