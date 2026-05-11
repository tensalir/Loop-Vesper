# Document Template

Loop CMF documents have a recognisable shape: a banner, a hero render, a component spec table, a palette block, and identity metadata. Operations matches on these visible regions, so the template is LOCK and never changes per-product. SKU labels, ordering, and notes are editable in the HTML preview before export.

## Contents

- Page geometry
- Banner
- Hero region
- Spec table
- Footer (palette + identity)
- Multi-SKU shared breakdown page
- HTML preview vs. PDF export
- Editing posture (what is editable, what is not)
- Approval gating

## Page geometry

- Aspect ratio: 16:9. Width 1280, height 720 (PDF coordinates). Matches Damien's source deck.
- Margins: 48px on all sides.
- Banner height: 80px.
- Footer height: 110px.
- Hero region: left half, from below the banner to above the footer.
- Spec table: right half, same vertical bounds.

The PDF (`src/lib/cmf/pdf.ts`) implements these constants. The HTML preview must use the same constants so the preview cannot drift from the final PDF.

## Banner

| Zone | Content |
|------|---------|
| Top-left | CMF code (bold), product family (muted, beneath) |
| Top-centre | Colourway name (primary colour, uppercase) |
| Top-right | Date (`YYYY-MM-DD`, mono), "Loop · CMF" (bold) |

The banner is sticky-feeling: every page in the packet uses the same banner with the SKU's colourway centred. The breakdown page uses "Pack breakdown" as the centre label.

## Hero region

- Light grey backplate inside the hero rectangle.
- The approved CMF render is centred and scaled to fit while preserving aspect ratio.
- No drop shadow, no border around the render itself.
- If no approved render exists, show a placeholder: "Render not generated yet" (muted, centred).

## Spec table

| Column | Width | Content |
|--------|-------|---------|
| Component | 22% | Swatch + label (label uses bold, swatch hex if known) |
| Pantone / Hex | 22% | Pantone token preferred, hex fallback, "—" when missing |
| Material | 18% | Material wording verbatim from workbook |
| Finish | 18% | Finish wording verbatim from workbook |
| Technique | 20% | Technique wording, muted colour |

Header row uses uppercase, muted text. Body rows are 22px high. Truncate at column width — never wrap (Operations expects single-line entries). Notes go in the editable preview block, not the spec table.

## Footer (palette + identity)

Left half: palette swatches with Pantone token underneath each swatch. Auto-laid out 4 per row.

Right half (identity column):

- "Identity" header
- `Product code  <code>` (mono)
- `EAN  <ean>` (mono)
- Packet notes (max width = right column), wrapped

## Multi-SKU shared breakdown page

Added automatically when the packet has more than one SKU. It is a single page summarising every SKU in the packet:

- Banner with "Pack breakdown" centre label.
- Grid of SKU cards (max 4 per row): colourway name (bold), product slug (mono), mini swatch row (up to 6 component swatches with labels).
- Packet notes at the bottom, muted, wrapped to full width.

## HTML preview vs. PDF export

The HTML preview is the source of truth for layout while a packet is in draft. The PDF generator consumes the same document model, so changes in the preview show up in the PDF without re-rendering attempts.

What this means in practice:

- Approving an attempt updates the hero render in the preview.
- Editing label / colourway / order / notes in the preview updates the preview immediately; the PDF picks it up on next export.
- Editing component data, Pantone, material, or finish is NOT done in the preview. Adjust the workbook upstream — the spec is contractual.

## Editing posture

| Editable in preview | Not editable in preview |
|---------------------|-------------------------|
| SKU ordering inside the packet | Component spec (material, finish, Pantone, technique) |
| Colourway label override | Components present (add / remove) |
| Packet notes / packet name | Approved render image (use approve flow instead) |
| Palette overrides (additional swatches beyond components) | Banner template / layout / aspect ratio |

The editable subset goes through a packet-level `documentDraft` object (see `src/lib/cmf/document.ts`). Workbook edits require re-import.

## Approval gating

Final PDF export is gated on every SKU having an approved render attempt.

- "Generate PDF" disabled until all SKUs have approvals.
- If `documentDraft` opts a SKU into "draft override" (showing a chosen attempt without approving), the export shows a warning watermark with `DRAFT` ribbon and the export filename gains a `_DRAFT` suffix. Use sparingly — most CMF reviews want clean approval-gated PDFs.
