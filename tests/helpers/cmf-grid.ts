import { FILL_COMPONENT, FILL_FIELD, FILL_HEADER_ROW, FILL_REQUIRED, type GridCell, type RawValue, type SheetGrid } from '../../src/lib/creative/cmf/workbook'

type At = RawValue | [RawValue, string | null]

/** A tab as the reader sees it, from rows of values or [value, fill] pairs; a plain value has no fill. */
export function grid(title: string, rows: At[][]): SheetGrid {
  const at = (r: number, c: number): GridCell => {
    const v = rows[r - 1]?.[c - 1]
    if (v === undefined) return { raw: null, fill: null }
    if (Array.isArray(v)) return { raw: v[0], fill: v[1] }
    return { raw: v as RawValue, fill: null }
  }
  return { title, maxRow: rows.length, maxCol: Math.max(...rows.map((r) => r.length)), cell: at }
}

/** The header row's fill, a component header's, a field name's, and a yellow (required) cell's. */
export const H = (v: RawValue): [RawValue, string] => [v, FILL_HEADER_ROW]
export const C = (v: RawValue): [RawValue, string] => [v, FILL_COMPONENT]
export const F = (v: RawValue): [RawValue, string] => [v, FILL_FIELD]
export const Y = (v: RawValue): [RawValue, string] => [v, FILL_REQUIRED]
