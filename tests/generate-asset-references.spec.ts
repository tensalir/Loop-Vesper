import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { KitSchema, type Kit } from '../src/lib/creative/kit-schema'
import type { LoadedKit } from '../src/lib/creative/kit'
import { servedView } from '../src/lib/creative/kit-set'
import { FREE_REFERENCE_CAP, orderReferences, referenceCapFor } from '../src/lib/headless/generate-asset'

/**
 * generate_asset with product renders: the render is image 1 (the kit lesson `render-first`), and
 * the creative kit's `max_references` for that product caps the images. Until 2026-10-01 the
 * caller's referenceImage went first and every call was capped at 4. A call without a render keeps
 * the cap of 4 (3bbf917, 2026-05-05, no reason recorded).
 */

const studio: Kit = KitSchema.parse(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creative', 'kit.v1.sample.json'), 'utf8'))
)
const served = servedView({ kit: studio } as LoadedKit<Kit>).kit
const eclipseMax = (studio.products.eclipse.generation as { max_references: number }).max_references

test.describe('generate_asset references', () => {
  test('the product render goes first, the caller reference after it', () => {
    const cap = referenceCapFor(['Eclipse'], served)
    expect(orderReferences(['data:render-1', 'data:render-2'], 'data:caller', cap)).toEqual(['data:render-1', 'data:render-2', 'data:caller'])
    expect(orderReferences(['data:render-1'], undefined, cap)).toEqual(['data:render-1'])
    expect(orderReferences([], 'data:caller', FREE_REFERENCE_CAP)).toEqual(['data:caller'])
  })

  test("with a render attached, the kit's max_references for that product is the cap", () => {
    expect(eclipseMax).toBe(3)
    const cap = referenceCapFor(['Eclipse'], served)
    expect(cap.cap).toBe(eclipseMax)
    expect(referenceCapFor(['Loop Eclipse'], served).cap).toBe(eclipseMax) // an alias of the product
    expect(() => orderReferences(['data:r1', 'data:r2', 'data:r3'], 'data:caller', cap)).toThrow(
      /Too many reference images \(4\)\. With a render of Eclipse attached, the cap is the creative kit's max_references for Eclipse: 3/
    )
    // The smallest cap wins when renders of several products are attached.
    const tighter = JSON.parse(JSON.stringify(served)) as Kit
    ;(tighter.products.packaging.generation as { max_references: number }).max_references = 2
    expect(referenceCapFor(['Eclipse', 'Packaging'], tighter).cap).toBe(2)
  })

  test('a call without a render, a product the kit does not carry, or no kit keeps the cap of 4', () => {
    expect(referenceCapFor([], served)).toBe(FREE_REFERENCE_CAP)
    expect(referenceCapFor(['Engage 2'], served)).toBe(FREE_REFERENCE_CAP)
    expect(referenceCapFor(['Eclipse'], null)).toBe(FREE_REFERENCE_CAP)
    expect(FREE_REFERENCE_CAP.cap).toBe(4)
    expect(orderReferences(['data:r1', 'data:r2', 'data:r3'], 'data:caller', FREE_REFERENCE_CAP)).toHaveLength(4)
    expect(() => orderReferences(['data:r1', 'data:r2', 'data:r3', 'data:r4'], 'data:caller', FREE_REFERENCE_CAP)).toThrow(
      'Too many reference images (5). Cap is 4 across referenceImage + productRenderIds.'
    )
  })

  test('executeGenerateAsset orders and caps through these, before any render is read', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/lib/headless/generate-asset.ts'), 'utf8')
    expect(src).toMatch(/const allRefs = orderReferences\(renderRefs, normalizedRef, cap\)/)
    const capAt = src.indexOf('assertReferenceCount(rows.length')
    const readAt = src.indexOf('rows.map((row) => readImageBytes(row.imageUrl))')
    expect(capAt).toBeGreaterThan(0)
    expect(capAt).toBeLessThan(readAt)
  })
})
