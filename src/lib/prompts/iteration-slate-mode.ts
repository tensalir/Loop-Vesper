/**
 * The Iteration Slate Mode: the JSON shape `iterate_prompt` asks the model for.
 *
 * It used to live only in `src/lib/prompts/genai-prompting.skill.md`, an older
 * copy of the prompting skill that nothing loads (its loader looks under
 * `lib/prompts`, without `src`). The skill iterate does load, and the Loop
 * edition from the creative kit, carry no schema, so iterate asked the model
 * to follow "the Iteration Slate Mode schema in your skill" that was not
 * there. It is appended here, whatever skill body iterate runs on, and only
 * when that body does not already carry it. The text is the old copy's,
 * verbatim.
 */

export const ITERATION_SLATE_MODE_HEADING = '## Iteration Slate Mode'

export const ITERATION_SLATE_MODE = `## Iteration Slate Mode (STRUCTURED OUTPUT)

When the user message begins with \`ITERATION_MODE\` (or the calling system requests structured iteration output), respond with **a single JSON object** that follows this schema. Do not include prose, markdown, or code fences around it.

\`\`\`json
{
  "theme": "one-sentence through-line every variant honors",
  "anchors": {
    "product": "what stays the same product-wise",
    "offer": "the unchanged offer/proposition",
    "audience": "ad-set audience cohort",
    "brand": "brand non-negotiables (logo, palette, voice, claims)",
    "lockedText": "headline/CTA/legal copy that must not change"
  },
  "axesVaried": ["e.g. Concept", "Persona", "Visual Treatment"],
  "weakChangesAvoided": [
    "short note about a weak-diversification trap intentionally avoided"
  ],
  "variants": [
    {
      "label": "A1 — Pain point / Documentary / 4:5",
      "axis": { "concept": "pain point", "persona": "focus-worker", "treatment": "documentary candid" },
      "prompt": "the actual generation prompt, ready to paste",
      "preserve": ["product hero", "brand palette", "headline copy"],
      "change": ["new persona", "new environment", "different lighting register"],
      "whyDifferentEnough": "one sentence explaining why this variant pulls a different lever from the baseline and from sibling variants"
    }
  ]
}
\`\`\`

**Rules for iteration output:**

- Generate 3–6 variants by default (respect any explicit count from the calling user message).
- Every variant MUST move on at least 2 of the listed \`axesVaried\`.
- Every variant MUST preserve every entry in \`anchors\` — same product, offer, audience, brand world, locked text.
- Reject weak changes by construction: do not output a variant whose only differences from the baseline are person identity, CTA wording, background color, prop swap, or a slight angle change while lighting/composition/treatment stay identical.
- Reject over-drift by construction: do not output a variant that changes the offer, audience cohort, brand world, or core theme.
- If a baseline image is referenced in the user message, perform a one-line read of the baseline's composition, lighting, persona, and treatment FIRST so each variant can credibly state how it differs.
- If the user explicitly locks an axis (e.g. "keep 4:5", "keep documentary look"), do not vary that axis — pick others.
- The \`prompt\` field for each variant must be a complete, paste-ready generation prompt that obeys the prompting craft above (semantic vs descriptive based on \`modelId\`, style-only vs full reference if a baseline image is attached, etc.).
- Output ONLY the JSON object. No preamble, no postscript, no markdown wrapping.`

/** The system prompt `iterate_prompt` sends: the skill body, then the slate schema once. */
export function buildIterateSystemPrompt(skillBody: string | null | undefined, fallback: string): string {
  const base = (skillBody && skillBody.trim()) || fallback
  if (base.includes(ITERATION_SLATE_MODE_HEADING)) return base
  return `${base}

---

${ITERATION_SLATE_MODE}`
}
