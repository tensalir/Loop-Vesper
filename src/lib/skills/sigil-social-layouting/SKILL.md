---
name: sigil-social-layouting
description: Generates on-brand social media layout specs (structure only) from creative intent and candidate LayoutDNA. Use when placing text and CTA on a base visual for paid social assets, ensuring safe zones, hierarchy, and brand consistency. Output is LayoutSpec JSON for Figma export.
---

# Sigil Social Layouting

You generate **layout structure** for social ad creatives: where text blocks go, typography, and hierarchy. You do not generate pixels or images; you output a strict **LayoutSpec** JSON that downstream tools convert to editable Figma frames.

## When to Use This Skill

- Generating text placement and hierarchy for a social ad (headline, CTA, legal, body)
- Given a creative brief (CTA, offer, channel, format) and optional reference LayoutDNA candidates
- Validating or repairing a layout spec against safe zones and brand rules
- Interpreting fuzzy brand intent ("more breathing room", "CTA prominent but not shouty") into concrete positions and scales

## Workflow

1. **Inputs**: Creative intent (CTA, headline, body, formatId, channel, language), optional base image analysis (focal point, negative space regions), and 0–5 candidate LayoutDNA examples from the layout space.
2. **Output**: A single `LayoutSpec` JSON (see references/layout-spec-schema.md) with text blocks, normalized bboxes (0–1), font family/weight/scale, and color. Include `rationale` and `confidence` (0–1).
3. **Validation**: Run the layout through the hard rails (safe zones, CTA minimum size, legal text size). If violations exist, repair and re-validate until valid or max iterations.

## Hard Rails (Non-Negotiable)

- **Safe zones**: No text or CTA may extend into platform safe zones. See references/platform-specs.md for 4x5 and 9x16 pixel dimensions. All positions in your output are in **normalized 0–1** space (0,0 = top-left; 1,1 = bottom-right). The validator converts to px using spec widthPx/heightPx.
- **CTA**: Minimum size and must lie entirely inside the safe zone.
- **Legal text**: Minimum effective font size (see platform spec). Use scale and maxWidth to allow for longer copy (e.g. German).
- **Contrast**: Text must meet minimum contrast ratio (WCAG AA) against typical backgrounds; prefer semantic color tokens (primary, foreground, muted).

## Fuzzy Interpretation

- **Breathing room**: Prefer placing text in the **negative space regions** provided from base image analysis when available. Avoid covering the focal point.
- **Hierarchy**: Match the **hierarchy depth** and **text-block count** of the candidate LayoutDNA when provided; do not invent many more blocks than the references.
- **Tone**: If the brief says "playful" or "minimal", adjust scale and weight (e.g. lighter weight, more space) within brand bounds.
- **Language**: For languages with longer words (e.g. German), use a larger maxWidth or slightly smaller scale so copy fits; reference languageScaleFactors in platform spec if provided.

## Brand Rules (Loop)

- **Fonts**: Avantt for display/headlines, Space Grotesk for body. Weights 400, 500, 600, 700.
- **Colors**: Use semantic tokens — primary (purple light / mint dark), foreground, muted. No raw hex in spec; use token names or hex from design system.
- **Spacing**: 4px base unit; keep padding between text blocks consistent with hierarchy.

## Output Format

Always return valid JSON matching the LayoutSpec schema. Include:

- `version`, `formatId`, `widthPx`, `heightPx`
- `textBlocks[]`: each with `id`, `role`, `content`, `bbox` (x, y, width, height in 0–1), `fontFamily`, `fontWeight`, `scale`, `color`
- `safeZone` (optional): topPx, bottomPx, leftPx, rightPx for reference
- `rationale`, `confidence`, `createdAt`

After generating, run the validator script (if available) and fix any violations before returning.

## References

- **Platform specs (safe zones, dimensions)**: See [references/platform-specs.md](references/platform-specs.md)
- **Brand rules (typography, color)**: See [references/brand-rules.md](references/brand-rules.md)
- **LayoutSpec JSON schema**: See [references/layout-spec-schema.md](references/layout-spec-schema.md)
