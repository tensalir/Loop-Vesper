# Document Template

Loop CMF documents have a recognisable shape: a top-of-page meta header (CMF number / Collection / Product name / Product code / EAN / Edit date / Drawn / Checked / Checked), a hero render with a vertical component spec list (Page 1), an optional clown reference page that anchors the model input back to the factory (Page 2), and a part breakdown grid (Page 3). The template mirrors Damien's source CMF deck so an exported PDF can drop straight into Loop's existing approval workflow without re-authoring.

## Contents

- Page geometry
- Meta header
- Page 1 (Product render + spec list)
- Page 2 (Clown reference)
- Page 3 (Part breakdown)
- Optional pack overview page (multi-SKU)
- HTML preview vs. PDF export
- Editing posture (what is editable, what is not)
- Approval gating

## Page geometry

- Aspect ratio: A4 portrait. Width 595, height 842 (PDF coordinates).
- Margins: 36pt on all sides.
- Header height: 96pt (holds the 3×3 meta grid).
- Footer height: 44pt (holds packet notes and the `-- N of M --` page marker).

The PDF (`src/lib/cmf/pdf.ts`) implements these constants and exports them as `CMF_PDF_GEOMETRY` for any consumer that needs to mirror the layout. The HTML preview is currently rendered at 16:9 (`CmfDocumentPreviewDialog.tsx`) so designers see roughly the same information density during draft; the PDF is the canonical surface for the designer-facing deliverable.

## Meta header

A 3×3 grid sits at the top of every page. Cells are LOCK; values change per SKU.

| Row 1 | Row 2 | Row 3 |
|-------|-------|-------|
| CMF number | Collection | Product name |
| Product code | EAN code | Edit date |
| Drawn | Checked | Checked |

Right of the grid: page label ("CMF Page 1" / "Clown reference" / "Part Break Down Page 2" / "Pack overview") in the primary colour, plus a DRAFT badge when `documentDraft.isDraft` is true.

## Page 1 (Product render + spec list)

- Section title: "Product render" (top-left, ink).
- Hero plate: full-width panel beneath the title, ~45% of inner height. Light grey backplate; the approved render is aspect-preserving fit inside.
- Component spec list: vertical stack below the hero plate. Each component has a labelled key/value block — Material, Finish, Colour, Artwork — that matches Damien's source template.
- Placeholder copy when no approved render is bound: "Render not generated yet" (muted, centred).

## Page 2 (Clown reference)

When a clown asset is registered for the SKU (the normal case), a dedicated reference page sits between the spec page and the breakdown. Designers asked for this so factories can map each painted region on the clown image back to its component without leaving the deck.

- Section title: "Clown reference" (top-left, ink) + the clown label in mono below.
- Hero plate: same proportions as the Page 1 render plate — light grey backplate with the clown image aspect-fit inside.
- Colour legend: a 2-column list under the image. Each row is a swatch chip (the clown region colour) next to the component label (e.g. "POM ring", "Cosmetic cap"). Components without `colorHex` are skipped silently; if no metadata is present at all, the page falls back to a short note ("No per-region colour metadata on this clown — match by visual reference.").

The clown asset is resolved with the same three-tier rule the renderer uses (explicit `clownAssetId` → exact variant → product-fallback pool), via `resolveClownAssetForRender` in `src/lib/cmf/render.ts`. If no clown is registered for the product at all, the clown page is skipped for that SKU and the deck continues with Page 1 → Page 3.

## Page 3 (Part breakdown)

- Section title: "Part break down" (top-left, ink).
- 2-column grid of cards, one per component. Each card shows the component label (primary colour), the swatch chip on the right, and a key/value column on the left with Pantone, Material, Finish, Technique.
- Cards wrap to additional rows; cells stop drawing when the page footer would collide.

## Optional pack overview page

When the packet has more than one SKU, a final overview page is appended:

- Same meta header, page label "Pack overview".
- "Pack breakdown" section title.
- Grid of SKU cards (2 per row): colourway name (bold, primary), product slug + product code (mono), mini swatch row.

## Footer

- 1px hairline at the top of the footer band.
- Packet notes (when set) wrap inside the left two thirds, muted.
- Page marker `-- N of M --` on the right (mono), counting every page in the packet including the pack overview.

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
| Palette overrides (additional swatches beyond components) | Meta header layout / page geometry |

The editable subset goes through a packet-level `documentDraft` object (see `src/lib/cmf/document.ts`). Workbook edits require re-import.

## Approval gating

Final PDF export is gated on every SKU having an approved render attempt.

- "Generate PDF" disabled until all SKUs have approvals.
- If `documentDraft` opts a SKU into "draft override" (showing a chosen attempt without approving), the export draws a DRAFT badge next to each page label and the filename gains a `_DRAFT` suffix. Use sparingly — most CMF reviews want clean approval-gated PDFs.
