# Workbook Schema

The CMF workbook is the source of truth for every render and PDF. Everything below is LOCK-level: the parser depends on these rules and a designer changing them silently breaks production.

## Contents

- Sheet model
- Banner block
- Component block
- Group headers
- Empty / placeholder rules
- Textile library
- What the workbook does not specify

## Sheet model

```
+----------+----------------+--------+--------+--------+
|          | Common specs   | SKU 1  | SKU 2  | SKU 3  |
+----------+----------------+--------+--------+--------+
| BANNER   |                |        |        |        |
| Field a  | shared value   | sku v  | sku v  | sku v  |
| ...      |                |        |        |        |
| COMPONENT (uppercase)     |        |        |        |
| Material | shared value   |        |        |        |
| Colour   |                | per-sku Pantone        |
| Finish   | shared value   |        |        |        |
+----------+----------------+--------+--------+--------+
```

One tab per product. Tab names that the parser recognises (case- and whitespace-insensitive):

| Tab name | Product slug |
|----------|--------------|
| `Switch 2` | `switch2` |
| `Switch 2 CC` | `case-switch2` |
| `Engage 2` | `engage2` |
| `Engage 2 CC` | `case-engage2` |
| `Experience 2` | `experience2` |
| `Experience 2 CC` | `case-experience2` |
| `Quiet 2` | `quiet2` |
| `Quiet 2 CC` | `case-quiet2` |
| `Dream` | `dream` |
| `Dream CC` | `case-dream` |
| `Cocoon` | `cocoon` |
| `Link` | `link` |
| `Aphrodite Earplug` | `aphrodite` |
| `Aphrodite CC` | `case-aphrodite` |
| `Eclipse` | `eclipse` |
| `README`, `Textile Library` | (skipped) |

A tab the parser cannot map is surfaced as an "unmapped sheet" warning — never silently dropped.

## Banner block

Always immediately after `BANNER` in column A. Recognised fields:

| Field (col A) | Goes to |
|---------------|---------|
| `CMF number` | `banner.cmfNumber` → `cmfCode` on the packet |
| `Collection` | shared (col B) — drives packet name / product family |
| `Product Name` | `banner.productName` → SKU colourway label |
| `Product Code` | `banner.productCode` |
| `EAN code` | `banner.ean` |
| `Edit Date` | `banner.editDate` |
| `Drawn by` | `banner.drawnBy` |
| `Checked by 1` / `Checked by 2` | `banner.checkedBy1/2` |

`Collection` is read from common spec (column B). Everything else is per-SKU (columns C onward).

## Component block

A component is any row in column A where column B and every SKU column is empty. It is followed by attribute rows.

Recognised attribute names (case-insensitive). Anything else falls into `notes` so context is preserved:

| Attribute (col A) | Maps to |
|-------------------|---------|
| `Material` | `material` |
| `Finish`, `Finishing`, `Finish Logo`, `Outer surface finish`, `UV coating` | `finish` |
| `Colour` / `Color` / `Colour and technic logo` | `pantone` (also kept verbatim in `notes`) |
| `Finishing Technique`, `Technique`, `Method` | `technique` |
| `Artwork`, `Mock-up`, `Coating`, `Transparency`, `Ref.code`, `Outer Shell`, `Inner Shell`, `Insert`, `Color Artwork`, `Color pigment %`, `Transmittance %`, `L*A*B=`, `Delta E`, `Reference finishing` | `notes` |

If column B has a value, it is shared across all SKUs. If a SKU column has a value, it overrides the common spec for that SKU. Column-B-only values still show up in the final spec table.

## Group headers

Some products group components under section headers like `CARRY CASE (1-11)` for Aphrodite CC or `BATTERY (12-14)`. These rows have:

- Uppercase or numbered-section text in column A.
- Empty column B and SKU columns.
- The **next** non-empty container row is also a container (another header), not an attribute row.

Group headers are kept in `parsedSheet.groups` for the PDF/HTML layout. They are not components themselves.

## Empty / placeholder rules

A value is a placeholder when it matches any of:

- Pure x runs: `xxxxxxxxxxx`, `XX`, `XXX`
- Pantone placeholders: `Pantone xxxxxxxxxxx`
- Date placeholders: `xx/xx/xxxx`
- CMF code placeholders: `CMF-xxxxxx rev x`
- Single separator: `/` or `-`

A SKU column is **filled** when at least one of the following is non-placeholder:

- `Product Name`
- `Product Code`
- `CMF number`
- Any per-SKU Pantone on a component row

The parser drops unfilled SKU columns even when other SKUs in the same tab are real. Surface the dropped count so the designer sees what was skipped.

## Textile library

The `Textile Library` tab lists reference codes (`BNY08-2`, `BYN08-02`, `3-7T`, `PA15EL-1`, ...) with photo paths. When a product spec uses one of these codes in a `Ref.code` row, the document template can embed the matching textile photo next to the spec table. The parser keeps the codes verbatim in component `notes`; the document layer is responsible for rendering them.

## What the workbook does not specify

Hex codes for Pantone values are not in the workbook. The HTML preview can approximate Pantone tokens (e.g. `Pantone 7720C` ≈ `#2F8F70`) for swatch rendering only. Final PDF spec text always uses the Pantone token, not the approximation, because Operations matches on Pantone.
