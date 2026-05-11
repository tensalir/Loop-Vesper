# Prompting (Nano Banana Recolour)

The recolour prompt is the contract between a CMF spec and a generated render. It needs to be specific enough that Nano Banana respects geometry and material response, and free enough that it can render holographic / iridescent / pearlescent finishes that KeyShot struggles with.

## Contents

- Anatomy of a CMF prompt
- Material phrasing
- Holographic / iridescent / pearlescent finishes
- Protected surfaces
- Negative space (what to forbid)
- Common failure modes and how to phrase around them
- When to deliberately diverge

## Anatomy of a CMF prompt

```
Using the attached image as a strict geometry reference, generate
{product framing} in the "{colourway label}" colourway.

Match the product silhouette, proportions, parting lines, lighting,
camera angle and background of the reference exactly.

Apply the following CMF spec component-by-component:
- {component label}: recolour to {pantone}, material {material}, {finish} finish
- ...

Do NOT change: {protected surfaces}. Keep them visually identical to the reference image.

Render at production quality: clean, crisp edges; correct material response.

Do NOT add logos, text, packaging, hands, models, props, lifestyle context,
or background gradients. Single product on a clean neutral backdrop,
suitable for a product CMF spec sheet.
```

This shape is GUIDE-level. The recoloured component lines are the meaningful surface area for variation; everything else is LOCK.

## Material phrasing

| Spec says | Prompt phrasing |
|-----------|-----------------|
| POM | "POM, matte" |
| ABS, PC/ABS, polycarbonate | "ABS satin" (default) or "polycarbonate semi-gloss" when finish is "gloss" / "shiny" |
| Silicone — opaque | "silicone, matte, opaque" |
| Silicone — translucent (Dream) | "silicone with ~30% milky translucency, soft sheen, slight light transmission" |
| Silicone — Shore 90 (Dream stem) | "firm silicone, semi-gloss" |
| Aluminium AL6063 | "anodised aluminium, brushed satin" (or "polished mirror" for high-gloss specs) |
| Fabric / microfiber | "woven fabric, matte, fibre direction visible" |
| Velcro / loop face | "looped velcro fabric, matte, no specular highlights" |
| Velcro / hook (TPU) | "hooked TPU velcro, matte, micro-scale grid texture" |
| PU foam | "open-cell PU foam, matte, slightly fibrous edge" |
| Pearlescent / iridescent paint | "pearlescent finish with subtle shift toward {hue} under highlight" |

When the workbook lists a coating like `NCVM`, `PVD`, or `UV high gloss`, drop the coating name into the prompt explicitly and trust Nano Banana to interpret it.

## Holographic / iridescent / pearlescent finishes

KeyShot struggled with these. Nano Banana excels.

- Use `holographic`, `iridescent`, or `pearlescent` explicitly. Do not paraphrase.
- Add the directional hint: "shifts toward {colour} under raking light".
- Add the negative: `no chromatic banding artefacts`, `no rainbow striping outside the holographic region`.
- Two or three attempts will look different from each other; that is expected — pick the one with the cleanest shift.

## Protected surfaces

For every component the workbook did NOT spec, name it explicitly in the "Do NOT change" block. Nano Banana respects this much better when the surface has a name than when it sees "everything else stays the same."

Pick names from the catalog labels (not snake-case region keys). Example for a Switch 2 SKU that only respecs the POM ring and cosmetic cap:

```
Do NOT change: Nozzle piece + retention ring, Eartip (hidden flange), Artwork.
Keep them visually identical to the reference image.
```

## Negative space (what to forbid)

The negatives are LOCK and should not change between SKUs:

- No logos (unless the spec asks for one — Loop logo on cases / artwork rows).
- No text / labels / packaging copy.
- No hands, models, ears, faces.
- No lifestyle / contextual backgrounds.
- No props (no smartphones, no bags, no headphones in frame).
- No background gradients — keep the backdrop a flat neutral.
- No depth-of-field blur outside the product silhouette.

## Common failure modes and how to phrase around them

| Symptom | Cause | Phrase to add |
|---------|-------|----------------|
| Cap colour leaks onto the ring | Mask drifted | "Keep regions hard-edged; do not blend colours across parting lines." |
| Eartip turned glossy when spec says matte | Material wording was generic | "Eartip silicone — matte, no specular reflection." |
| Geometry slightly distorted | Prompt allowed creative reinterpretation | "Match silhouette exactly; do not stylise proportions." |
| Background got a gradient | Background prompt forgotten | "Flat #fafafa neutral backdrop. No vignette." |
| Holographic looks like a sticker | Material described too literally | Add "embedded in the material, not painted on top." |
| Pantone too saturated | Nano Banana over-corrects | Reference the hex approximation in parentheses, e.g. "Pantone 7720C (≈ #2f8f70)" |

## When to deliberately diverge

The skill is normally LOCK + GUIDE. Two cases where DREAM is appropriate:

1. **Concept exploration**, before a workbook exists. Designer wants to see "what if Switch 2 went pearlescent emerald with a chrome ring?". Run a few EXPLORE / DREAM attempts off a clown without a workbook. Mark these as drafts; they never feed into the final packet.
2. **Material translation**, when a finish has no precedent in the product family. Generate a small fan of attempts at different finish strengths (matte → satin → semi-gloss → gloss) so the designer can pick the one closest to factory intent.

In both cases, switch back to LOCK before exporting a customer-facing PDF.
