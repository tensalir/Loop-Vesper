# Prompting (Nano Banana Recolour)

The recolour prompt is the contract between a CMF spec and a generated render. The canonical reference is the prompt Damien hand-tuned on Nano Banana / GPT-Image that consistently produces production-grade Switch 2 colourways. The deterministic prompt builder (`src/lib/cmf/prompt.ts`) mirrors its structure.

## Contents

- Canonical prompt (Damien, Switch 2 teal)
- Universal structure
- Material vocabulary (LOCK)
- Per-surface region addressing
- Lighting + quality bar
- Common failure modes
- When to deliberately diverge

## Canonical prompt (Damien, Switch 2 teal)

This is the gold standard. Every change to the deterministic prompt builder should be measured against this output.

```
Using the provided 3D clown CMF render of the Loop Switch 2 earplugs, convert it into a photorealistic studio product shot.

Preserve the geometry, design, angle, framing, composition, and the relative positions of both earplug units exactly as in the source image. Do not alter the pose, perspective, scale, dial shape, ring shape, eartip shape, or any structural detail. Keep the "L" and "R" markings intact in the same location and orientation. Keep the pure black background unchanged.

Replace only the materials, colors, and lighting as follows:
- Every BLUE surface (outer ring / dial bezel) → satin-finish teal metal. Brushed anisotropic highlights running along the ring, soft metallic sheen, fine satin grain, slightly cool deep teal tone reminiscent of anodized aluminum.
- Every RED surface (main body / housing) → matte teal plastic in the same teal family. Diffuse low-sheen surface, no gloss, no specular hotspots, very subtle micro-texture. Slightly warmer/softer than the metal.
- Every PINK surface (silicone eartips) → translucent milky teal silicone. Soft frosted appearance with gentle subsurface light scattering, smooth rubbery micro-surface, light visibly passes through the thinner edges, no hard reflections.

Lighting: clean studio product photography. Soft large key light from upper left, subtle fill from lower right to reveal the satin grain on the metal and the translucency of the silicone, gentle rim light to separate the products from the black background. Realistic contact shadows and ambient occlusion where parts meet. Sharp focus across both earplugs.

Photorealistic 4K product render quality with believable micro-surface detail. Output should look like a real photographed sample, not a CGI render.
```

Three things make this prompt good:

1. **It addresses regions by their clown colour** ("Every BLUE surface", "Every RED surface", "Every PINK surface") rather than by component name. Nano Banana sees the clown's colours directly and needs no semantic mapping. This is the most reliable region-addressing strategy when the clown PNG is well-painted.
2. **Material vocabulary is rich and specific** — anisotropic highlights, subsurface scattering, frosted appearance, contact shadows, ambient occlusion. The model reads these as steering signals, not decoration.
3. **The quality bar lives at the end** — "real photographed sample, not a CGI render". Without this, Nano Banana defaults to a CGI feel.

## Universal structure

Every CMF prompt should follow this skeleton. The deterministic builder produces it for every SKU. Substitute the bracketed pieces from the workbook row.

```
Using the provided 3D clown CMF render of {productPhrase}, convert it into a
photorealistic studio product shot in the "{colourwayLabel}" colourway.

Preserve the geometry, design, angle, framing, composition, and the relative
positions of every unit exactly as in the source image. Do not alter the pose,
perspective, scale, silhouette, parting lines, or any structural detail. Keep
any text, markings, or labels intact in the same location and orientation.
Keep the source background unchanged.

Replace only the materials, colors, and lighting as follows:
- {component label}: recolour to {pantone} ({hex}) — {material vocabulary}, {finish vocabulary}, {technique if any}
- ...

Do NOT change: {protected surfaces}. Keep them visually identical to the reference image.

Lighting: clean studio product photography. Soft large key light from upper
left, subtle fill from lower right, gentle rim light to separate the products
from the background. Realistic contact shadows and ambient occlusion where
parts meet. Sharp focus across every unit.

Photorealistic 4K product render quality with believable micro-surface detail.
Output should look like a real photographed sample, not a CGI render.
```

The preserve / lighting / quality clauses are LOCK. Only the recolour lines and the protected-surfaces list vary per SKU.

## Material vocabulary (LOCK)

When the workbook says... use this wording in the prompt:

| Workbook says | Wording |
|---------------|---------|
| POM | `POM with subtle matte finish, fine micro-texture, no specular hotspots` |
| ABS / PC-ABS / polycarbonate (satin/NCVM/VDI 24 default) | `ABS with satin micro-texture, soft diffuse sheen, low specular response` |
| ABS / PC-ABS with `gloss` / `highgloss` / `mirror` finish | `polycarbonate with high-gloss mirror polish, sharp specular highlights, deep reflections` |
| ABS with `NCVM` coating | `NCVM-coated ABS, satin metal-like finish, brushed anisotropic highlights, fine satin grain reminiscent of anodized aluminum` |
| Silicone, default | `opaque silicone with soft rubbery sheen, smooth micro-surface, gentle pliable appearance` |
| Silicone, Shore 30 OR finish mentions `translucent` / `milky` / `see-through` | `translucent milky silicone with gentle subsurface light scattering, frosted appearance, smooth rubbery micro-surface, light visibly passes through the thinner edges, no hard reflections` |
| Silicone, Shore 90 | `firm silicone with semi-gloss surface, slight specular response, smooth micro-texture` |
| Aluminium AL6063 + brushed/satin finish | `anodised aluminium with brushed satin finish, fine anisotropic grain, soft metallic sheen` |
| Aluminium AL6063 + mirror/polished finish | `polished aluminium with mirror finish, sharp specular highlights, deep reflections` |
| PU foam | `open-cell PU foam, matte, slightly fibrous edge, soft diffuse surface` |
| Fabric / microfiber / nylon (woven) | `woven fabric with matte surface, visible fibre direction, no specular highlights` |
| Velcro loop / PA velcro | `looped velcro fabric, matte, no specular highlights, soft brushed appearance` |
| Velcro hook / TPU | `hooked TPU velcro, matte, micro-scale grid texture` |
| TPE | `TPE with soft matte surface, slight pliability, no specular hotspots` |
| Anything `holographic`, `iridescent`, `pearlescent` | append `with holographic/iridescent/pearlescent shift, embedded in the material, not painted on top. No chromatic banding outside the intended region.` |

The workbook material wording is kept verbatim in addition to the rich vocabulary, so factory matching always has the source-of-truth string.

## Per-surface region addressing

Two strategies, picked by the builder based on what data is available:

1. **By clown colour** (preferred when the clown asset has per-region `colorHex`):
   `Every {COLOR} surface ({component label}) → {recolour spec}`
   This is what Damien's prompt does. The clown PNG paints each recolourable region in a stable colour (red, green, blue, yellow, plus pink as a fifth where needed), the prompt names that colour, and Nano Banana reads the clown directly. Most reliable.

2. **By component label** (fallback when the clown has no colour map):
   `{Component label}: {recolour spec}`
   Less reliable because the model has to map the label to a region in the PNG, but acceptable when the clown is well-segmented and the label matches a single obvious surface.

The deterministic builder picks (1) when the resolved clown asset's `components[]` carries `colorHex` entries for the regions in the row's spec, otherwise (2). Designers can always upload a clown PNG with colour metadata to upgrade a product family to (1) addressing.

## Lighting + quality bar

Both are LOCK and the same across every SKU:

- Soft large key light, upper left.
- Subtle fill, lower right.
- Gentle rim light separating product from background.
- Realistic contact shadows + ambient occlusion at part interfaces.
- Sharp focus across every unit.
- Photorealistic 4K render quality with believable micro-surface detail.
- "Output should look like a real photographed sample, not a CGI render."

The last line is non-negotiable. Without it, Nano Banana tends to settle for a CGI-feel render.

## Common failure modes

| Symptom | Phrase to add |
|---------|---------------|
| Cap colour leaks onto the ring | Add to preserve clause: "Keep regions hard-edged; do not blend colours across parting lines." |
| Eartip turned glossy when spec says matte | Already covered by silicone vocabulary above; double-check the matte rule is in the finish description. |
| Geometry slightly distorted | The preserve clause already covers this; if it persists, add "Treat the silhouette as a strict mask." |
| Background gradient appeared | The "keep the source background unchanged" line forbids this; if the clown PNG has a gradient backdrop, replace it with a black or neutral PNG first. |
| Holographic looks like a sticker | Add: "embedded in the material, not painted on top." (Already in the iridescent vocabulary.) |
| Pantone too saturated | Reference the hex approximation in parentheses, e.g. "Pantone 7720C (≈ #2f8f70) — a slightly cool deep teal". |
| Output feels like CGI | Make sure the quality bar line is present verbatim. Bump model to Nano Banana Pro if it isn't already. |
| L/R markings rotated or missing | The preserve clause already names "any text, markings, or labels"; if the model still drops them, add a product-specific call-out: "Keep the L and R laser-etched markings intact." |

## When to deliberately diverge

The skill is normally LOCK + GUIDE. Two cases where DREAM is appropriate:

1. **Concept exploration**, before a workbook exists. Designer wants to see "what if Switch 2 went pearlescent emerald with a chrome ring?". Run a few EXPLORE / DREAM attempts off a clown without a workbook. Mark these as drafts; they never feed into the final packet.
2. **Material translation**, when a finish has no precedent in the product family. Generate a small fan of attempts at different finish strengths (matte → satin → semi-gloss → gloss) so the designer can pick the one closest to factory intent.

In both cases, switch back to LOCK before exporting a customer-facing PDF.
