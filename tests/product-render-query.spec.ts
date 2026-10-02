import { test, expect } from '@playwright/test'
import { interpretRenderQuery, describeQuery, type CatalogEntry } from '../src/lib/product-renders/query'

const CATALOG: CatalogEntry[] = [
  { name: 'Live Pro', colorway: 'Iridescent' },
  { name: 'Live Pro', colorway: 'Black' },
  { name: 'Live Pro', colorway: 'Holographic Blue Satin' },
  { name: 'Live Pro', colorway: 'All colourways' },
  { name: 'Dream', colorway: 'Black' },
  { name: 'Dream', colorway: 'Lilac' },
  { name: 'Engage 2', colorway: 'Clear' },
  { name: 'Switch 2', colorway: 'Emerald' },
  { name: 'Eclipse', colorway: 'Deep Teal' },
]

test.describe('interpretRenderQuery: a request read the way a colleague says it', () => {
  test('the codename, the brand form and the name all find Live Pro', () => {
    for (const phrase of ['Aphrodite', 'aphrodite', 'Loop Live Pro', 'Live Pro', 'the Loop Aphrodite earplugs', 'LivePro', 'live-pro']) {
      expect(interpretRenderQuery(phrase, CATALOG).name, phrase).toBe('Live Pro')
    }
  })

  test('a kind of picture named in the phrase narrows to it', () => {
    expect(interpretRenderQuery('Aphrodite in the ear', CATALOG)).toMatchObject({ name: 'Live Pro', renderType: 'in-ear' })
    expect(interpretRenderQuery('someone wearing the Loop Live Pro', CATALOG)).toMatchObject({ name: 'Live Pro', renderType: 'in-ear' })
    expect(interpretRenderQuery('Live Pro packaging', CATALOG)).toMatchObject({ name: 'Live Pro', renderType: 'packaging' })
    expect(interpretRenderQuery('the Live Pro box on a shelf', CATALOG)).toMatchObject({ name: 'Live Pro', renderType: 'packaging' })
    expect(interpretRenderQuery('Aphrodite charging case, open', CATALOG)).toMatchObject({ name: 'Live Pro', renderType: 'case' })
  })

  test('a colourway named in the phrase narrows to it, only among the product\'s own', () => {
    expect(interpretRenderQuery('the Loop Live Pro box in black', CATALOG)).toMatchObject({
      name: 'Live Pro', colorway: 'Black', renderType: 'packaging',
    })
    expect(interpretRenderQuery('Live Pro holographic blue satin', CATALOG)).toMatchObject({ colorway: 'Holographic Blue Satin' })
    expect(interpretRenderQuery('Dream in lilac', CATALOG)).toMatchObject({ name: 'Dream', colorway: 'Lilac' })
    expect(interpretRenderQuery('Live Pro in lilac', CATALOG).colorway).toBeUndefined()
  })

  test('other products are found inside a phrase too', () => {
    expect(interpretRenderQuery('Loop Engage 2 clear, a pair', CATALOG)).toMatchObject({ name: 'Engage 2', colorway: 'Clear', renderType: 'pair' })
    expect(interpretRenderQuery('Switch 2', CATALOG).name).toBe('Switch 2')
    expect(interpretRenderQuery('Eclipse', CATALOG)).toMatchObject({ name: 'Eclipse', recognised: true })
  })

  test('a phrase with no product in it is searched as it came, the brand dropped', () => {
    expect(interpretRenderQuery('Loop Nonexistent', CATALOG)).toEqual({ name: 'Nonexistent', recognised: false })
    expect(describeQuery('Loop Nonexistent', interpretRenderQuery('Loop Nonexistent', CATALOG))).toBeNull()
  })

  test('the reading is said in one line', () => {
    expect(describeQuery('Aphrodite in the ear', interpretRenderQuery('Aphrodite in the ear', CATALOG)))
      .toBe('Read "Aphrodite in the ear" as Live Pro, in-ear.')
  })
})
