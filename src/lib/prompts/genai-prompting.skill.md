---
name: genai-prompting
description: Crafts prompts for AI image and video generation models, and produces diversified prompt slates for paid social and ad sets. Covers text-to-image, semantic editing, image-to-video, text-to-video, Midjourney, and Meta-Andromeda-aware ad iteration. Use when the user requests prompts for Imagen, Gemini/Nano Banana, Nano Banana 2, Nano Banana Pro, GPT Image, GPT Image 2 (gpt-image-2), Seedream, VEO, Sora, Runway, Kling, MiniMax, or Midjourney, or mentions "image prompt", "motion prompt", "VEO prompt", "Nano Banana prompt", "GPT Image prompt", "video prompt", "sref permutation", "style reference", "character consistency", "reference image", "ad variations", "ad set variations", "creative diversification", "Andromeda", or "Meta ad iteration". Also triggers when structuring reference images, separating style from character from object refs, getting a new scene from an existing generation, or building a slate of genuinely different ads from one concept.
---

# Generative AI Prompt Engineering

Craft prompts by understanding how generation models interpret language. Models update constantly; what stays stable are the principles of how these systems read intent.

## Core Philosophy

**These models are black boxes.** Prompting is iteration, not exact science. Results come from reps and pattern recognition.

**Iteration reality:** Expect 50–100+ generations for video, 10–30 for images. Plan for it.

**Describe the scene, don't list keywords.** A narrative paragraph almost always produces more coherent images than a pile of disconnected words. Use the model's language understanding instead of fighting it.

---

## The Two Modes

### 1. Semantic Prompting (Conversational)
**Models:** Nano Banana 2, Nano Banana Pro, GPT Image 2, Seedream, Gemini image editing

These models understand *intent*. Speak to them like a collaborator. They parse meaning, handle multi-turn refinement, and reason about complex compositions.

### 2. Descriptive Prompting (Keyword-Dense)
**Models:** Midjourney, DALL-E, Stable Diffusion, Flux, most T2I/T2V models

These models respond to *density of description*. They pattern-match against training data. Stack adjectives, reference artists and styles, describe physical attributes explicitly.

---

## Universal T2I Structure

Most text-to-image models respond well to this structure (incorporate naturally, not as rigid template):

1. **Subject** — physical details, age, clothing, pose
2. **Environment** — location, props, atmosphere, time of day
3. **Camera** — lens (35mm/50mm/85mm), angle, framing, depth of field
4. **Lighting** — quality, direction, temperature, source
5. **Aesthetic** — style reference, mood, processing look

**Example:**
```
Photorealistic 4K photograph of a middle-aged woman with graying brown hair tied back loosely, wearing a faded olive apron over a cream linen shirt. She stands at a wooden kitchen counter, hands resting on a cutting board with fresh herbs, slight tension in her jaw. Morning light from a window camera-left creates soft shadows. Shot with 50mm lens at eye level, shallow depth of field. Raw, unprocessed photography style with natural skin texture.
```

---

## Reference Image Roles

When providing multiple reference images, **explicitly label each image's purpose**. Models treat unlabeled references as content to reproduce. Labels force role separation.

### The Three Roles

- **STYLE REFERENCE** — Match aesthetic, materials, lighting, palette. NOT scene content.
- **CHARACTER REFERENCE** — Match face, build, clothing, identity markers.
- **OBJECT REFERENCE** — Reproduce this specific item with high fidelity.

### Pattern

```
REFERENCE IMAGE ROLES:
— [describe image]: STYLE REFERENCE ONLY. Match [specific qualities].
  DO NOT recreate this scene or room.
— [describe image]: CHARACTER REFERENCE. Match this person's [details].
— [describe image]: OBJECT REFERENCE. Reproduce this exact [item].

NEW SCENE (entirely different from the style reference):
[vivid, specific description of the new setting]
```

### Scene Differentiation

When using a generated image as style reference for a NEW scene:
- State "DO NOT recreate this scene or room" after the style reference
- Make the new environment **deliberately different** in geometry (corridor vs. temple, outdoor vs. indoor)
- The more vivid and specific the new setting description, the more it overrides the reference scene
- Describe the reference images by visual content, not by filename or position — uploads can arrive in any order

### Model Limits (Reference Images)

| Model | Object refs | Character refs | Total | Notes |
|-------|-----------|---------------|-------|-------|
| Nano Banana 2 (3.1 Flash) | Up to 10 | Up to 4 | 14 | |
| Nano Banana Pro (3 Pro) | Up to 6 | Up to 5 | 14 | |
| GPT Image 2 | Multiple | Multiple | First 5 preserved at high fidelity when `input_fidelity: high` | |

---

## Style Reference: Style-Only vs Full Reference

**THIS IS A NANO BANANA / GPT IMAGE WORKFLOW.** When a user attaches an image and says "use this as a style reference" (or similar), they intend to use semantic image generation with the attached image as input.

### CRITICAL: Style Reference = STYLE-ONLY by Default

**THE DEFAULT ASSUMPTION:** When a user says "style reference", "use for style", "as a style reference", or similar, they want **STYLE-ONLY** extraction. This is the most common intent and should be the default behavior.

**Why this matters:** Image generation models naturally want to reproduce what they see. Without explicit anti-composition instructions, they will copy subjects, poses, and scene layouts from the reference. A style reference is meant to transfer ONLY the visual treatment (lighting, color, mood), not the content.

### STYLE-ONLY Reference (DEFAULT for "style reference")

**When to apply:** ANY time the user mentions "style reference", "style ref", "use for style", "as a style", "this style", etc. — UNLESS they explicitly ask to recreate or maintain the composition.

**EXTRACT (visual treatment only):**
- Color grading / color palette / tonal range
- Lighting quality (soft, hard, direction, temperature)
- Atmosphere / mood / emotional tone
- Texture / grain / processing style
- Contrast levels and dynamic range
- Shadow and highlight treatment
- Depth rendering / atmospheric perspective feel

**EXPLICITLY BLOCK (compositional elements):**
- Specific subjects (people, mountains, tents, animals, objects)
- Scene layout or spatial arrangement
- Poses, positioning, or body language
- Geographic or environmental specifics
- Props, furniture, or background objects

**Style-Only Prompt Format:**
```
Using the attached image ONLY as a style reference—extract its [specific visual qualities you observe: color grading, lighting mood, texture, atmosphere].

IMPORTANT: Do NOT reproduce the [list main subjects/objects you see in reference]. Do NOT copy the scene composition, subject positioning, or spatial layout. The reference image defines ONLY the visual treatment and color mood.

Apply this visual style to: [user's completely different subject/scene]. Create a fresh composition appropriate for this new subject.
```

### FULL Reference (ONLY when explicitly requested)

**When to apply:** ONLY when the user explicitly says "recreate", "match the composition", "similar scene", "same layout", "keep the same setup", or clearly wants compositional elements maintained.

**Full Reference Prompt Format:**
```
Using the attached image as a reference for BOTH its visual style AND compositional elements: [describe what compositional elements to maintain]. [New subject/scene that builds on the reference while maintaining specified composition]. Match the [specific characteristics] exactly.
```

### Analysis Requirements

Before writing prompts with a reference image, you MUST:

1. **Analyze the actual image** — colors, lighting, mood, composition, texture, grain
2. **Extract the specific aesthetic** from what you SEE, not what you assume
3. **NEVER inject a different style** — if the image is warm and colorful, don't suggest monochromatic
4. **Describe what you observe** with concrete language ("muted earth tones", "soft diffused light", "subtle blue-gray color grading", "film grain texture")
5. **Identify subjects to BLOCK** — for style-only references, list what subjects/objects the model should NOT reproduce
6. **Default to style-only** unless the user explicitly asks for composition

### What NOT to Do

- Do NOT write prompts that omit reference to the attached image
- Do NOT describe a different aesthetic than what you see
- Do NOT include compositional elements from the reference when user says "style reference" (default — composition requires EXPLICIT request)
- Do NOT assume composition is wanted just because an image is attached
- Do NOT forget the explicit "Do NOT reproduce..." blocking statement

### Terminology: "Nano Banana" is a model name (not a banana)

- **Nano Banana** refers to Gemini's native image generation capabilities (model nickname), not the fruit
- **Do NOT introduce bananas** into the prompt unless the user explicitly requested bananas in the image

---

## Context-Dependent Aesthetics

### Midjourney
Cinematic/dramatic is baked in. Don't suppress it, don't amplify it. Just write descriptive content.

### Semantic Models (Nano Banana, GPT Image)
The cinematic discussion isn't relevant — work conversationally. Focus on clear intent about what to create, change, or preserve.

### Generic T2I (Krea, Flux, etc.)
When the user asks for a general T2I prompt without specifying a model, assume naturalistic output:

**Avoid:** cinematic, dramatic, epic, beautiful, stunning, breathtaking, masterpiece
**Use:** documentary-style, naturalistic, raw, ungraded, photojournalistic, candid

**Describe actions, not emotions:**
- Not "looks sad" → "corners of mouth turn slightly downward"
- Not "appears angry" → "jaw tightens, brow furrows"

**Describe what you want, not what you don't want:**
- Not "No dramatic lighting" → "Flat even lighting, matte surfaces"

---

## Semantic Editing (Nano Banana / Seedream / GPT Image)

These are conversational tools. Be explicit about what stays unchanged — models need anchors.

### Adding/Removing
```
Using the provided reference photo of the modern office space, add a large potted monstera plant in the corner near the window. Match existing soft lighting and perspective exactly. Keep all furniture, wall colors, and shadows unchanged.
```

### Semantic Swapping
```
In the provided image, change only the red ceramic mug to a clear glass water bottle. Preserve all other elements exactly: marble countertop veining, lighting reflections, background items, and composition.
```

### Style Transfer
```
Transform the provided street photograph into 1970s film style: slightly desaturated colors, subtle grain, softer contrast, warmer shadows. Preserve exact composition, subjects, and spatial relationships.
```

### Product Placement
```
Using provided images, place the earplug case from image 2 onto the wooden desk from image 1. Position in foreground right third, matching warm afternoon lighting exactly. Preserve all wood grain detail with natural shadow contact.
```

### Environment Transformation
```
Keep the person exactly as they appear—same face, expression, hair, clothing. Change only the background from office to sunlit outdoor cafe with blurred passersby. Match lighting direction to suggest natural daylight.
```

---

## Character Consistency

Create a detailed description once, reuse verbatim across prompts:

```
SARAH: Early 40s woman with shoulder-length auburn hair with visible gray at temples, oval face with slight crow's feet, green-gray eyes, small mole on left cheek. Wearing navy wool cardigan over white cotton blouse, reading glasses pushed up on head. Medium build with slightly rounded shoulders.
```

When character reference images are available (Nano Banana 2/Pro, GPT Image 2 with `input_fidelity: high`), combine the image reference with minimal text anchors instead of re-describing what's visible.

---

## Iteration & Variation — The Andromeda Lens

When the task is a **slate of variations** rather than a single image — paid social, ad sets, A/B testing, campaign creative — the prompting craft is necessary but not sufficient. The slate has to be diversified along the right axes, or it won't survive Meta's Andromeda retrieval.

### What Andromeda Rewards

Meta Andromeda is the retrieval engine that decides which ads from your ad set get considered for which person. It rewards **creative diversification**: a range of ads that differ in meaningful ways so the system can match the right ad to the right viewer. Top advertisers now run 15–50 ads per ad set instead of the old 6-ad cap.

But more isn't better. Two ads with the same concept and slightly different photos will get treated as one signal. They take up two ad slots and contribute one piece of information.

The constraint is two-sided:

- **Too similar** (same concept, same execution, cosmetic tweaks) → Meta treats them as the same ad. The slate is wasted.
- **Too different** (different audiences, different offers, different brand worlds) → Meta will rank them across audiences in ways that fragment the ad set. They probably belong in a different ad set entirely.

The sweet spot: **same theme, meaningfully different execution.** Same audience cohort, same offer, same brand world — different angle, format, persona, or visual treatment.

### The Weak / Strong Diversification Test

Before accepting a slate, run it through this test.

**Weak diversification (will not survive Andromeda):**
- Same concept, different background color
- Same concept, different model wearing the same outfit
- Same hero shot, different CTA button
- Same headline reworded
- Same demo shot from a slightly different angle
- Same image with different overlay text positions
- AI variations of the same generation seed
- Different person, identical composition / lighting / framing / wardrobe register

**Strong diversification (real signal for Andromeda):**
- Pain-point hook + product demo + social proof testimonial (same offer)
- Lifestyle / context shot + clinical / spec-sheet shot + UGC selfie (same product)
- 9:16 video + 4:5 static + 1:1 carousel (same concept, different formats)
- Parent persona + festival-goer persona + sleeper persona (same product, different audience angles)
- Bold typographic poster + photographic hero + animated explainer (same idea, different visual languages)

Rule of thumb: **if you can imagine two completely different people responding to two ads in your slate, the slate is diversifying. If the same person would shrug at the difference, it isn't.**

### The Diversification Axes

A slate gets meaningful difference by varying along these axes. Pull on at least 2–3 per slate. Don't try to vary all of them — that often pushes the slate across the "different ad set" line.

1. **Concept / Angle** — pain point, demo, testimonial, lifestyle, curiosity, comparison, contrarian, educational
2. **Format** — static, short video, long video, carousel, cinemagraph, stop-motion
3. **Aspect Ratio (Placement Fit)** — 9:16 (Reels/Stories), 4:5 (feed), 1:1 (universal)
4. **Persona / Audience Angle** — same product, different "you" (parents, neurodivergent adults, festival-goers, side-sleepers, focus-workers, musicians, frequent flyers, etc.)
5. **Visual Treatment** — documentary, studio/clinical, typographic poster, illustrated, UGC, editorial, color-blocked, high-contrast/low-fi
6. **Copy Style / Hook Pattern** — question, statistic, confession, direct command, contrarian, list/numbered
7. **Model / Generator Diversity** — mixing semantic generators (GPT Image 2 + Nano Banana Pro) prevents the slate from inheriting one model's visual fingerprint

### Anchors That Must Stay Constant Across the Slate

Lock these so the ads still belong to one ad set:

- **Product / SKU**
- **Offer** (e.g. -20% launch, free shipping, new colorway)
- **Audience cohort** (the broad cohort this ad set targets)
- **Theme / through-line** (one sentence every ad in the slate honors)
- **Brand non-negotiables** (logo placement, palette boundaries, voice, claims to avoid, mandatory legal copy)

### Common Failure Modes

- **Cosmetic-variation trap.** Same concept with rotated props. Visual variance feels like work; diversification value is zero. Fix: every prompt must move on at least one axis the matrix tracks.
- **Theme-drift trap.** Slate starts on "earplugs for parents of toddlers" and ends on "earplugs for festival-goers." Two ad sets, not one. Fix: lock the theme and check every prompt against it.
- **Format-only diversification.** Same concept rendered as static + short video + long video. *Some* diversification, but thin alone. Combine with a second axis.
- **Generator monoculture.** Slate generated entirely by one model inherits that model's aesthetic biases. Fix: mix generators across the slate.
- **Brand-incoherence trap.** Pushing diversification so hard the ads stop feeling like the same brand. Fix: brand non-negotiables in the header; visual register can stretch but not break.
- **Over-quantification.** Going to 50 ads because "Andromeda likes scale." Quantity without diversity is expensive monoculture.

### Quick-Start Slate Templates

- **Slate of 6 (entry-level)** — 3 concepts × 2 formats
- **Slate of 9 (mid-budget)** — 3 concepts × 3 formats
- **Slate of 12 (persona-aware)** — 3 personas × 2 concepts × 2 formats
- **Slate of 15+ (full Andromeda mode)** — 3 personas × 3 concepts × 2 formats + a creative wildcard cluster

---

## Iteration Slate Mode (STRUCTURED OUTPUT)

When the user message begins with `ITERATION_MODE` (or the calling system requests structured iteration output), respond with **a single JSON object** that follows this schema. Do not include prose, markdown, or code fences around it.

```json
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
```

**Rules for iteration output:**

- Generate 3–6 variants by default (respect any explicit count from the calling user message).
- Every variant MUST move on at least 2 of the listed `axesVaried`.
- Every variant MUST preserve every entry in `anchors` — same product, offer, audience, brand world, locked text.
- Reject weak changes by construction: do not output a variant whose only differences from the baseline are person identity, CTA wording, background color, prop swap, or a slight angle change while lighting/composition/treatment stay identical.
- Reject over-drift by construction: do not output a variant that changes the offer, audience cohort, brand world, or core theme.
- If a baseline image is referenced in the user message, perform a one-line read of the baseline's composition, lighting, persona, and treatment FIRST so each variant can credibly state how it differs.
- If the user explicitly locks an axis (e.g. "keep 4:5", "keep documentary look"), do not vary that axis — pick others.
- The `prompt` field for each variant must be a complete, paste-ready generation prompt that obeys the prompting craft above (semantic vs descriptive based on `modelId`, style-only vs full reference if a baseline image is attached, etc.).
- Output ONLY the JSON object. No preamble, no postscript, no markdown wrapping.

---

## Image-to-Video / Motion Prompts

**Golden Rule:** The source image IS frame one. Do NOT re-describe the scene. Describe ONLY:
- What moves
- Camera behavior
- Audio landscape
- Pacing/timing

**Structure:** `[Camera behavior] + [Subject action with timing] + [Audio] + [Pacing]`

**Static Camera Escalation** (when you need the camera to NOT move):
- Level 1: `The camera remains static`
- Level 2: `Fixed tripod shot with absolutely no camera movement`
- Level 3: `LOCKED STATIC FRAME: Camera mounted on heavy tripod, does not move, pan, tilt, zoom, or drift throughout entire sequence`

**Audio matters** (especially for newer models):
- Avoid vague: "ambient sounds", "background noise"
- Be specific: "ceramic mug placed on wooden surface (soft clink)", "distant traffic hum with occasional horn"
- Dialogue format: `A man murmurs, 'This must be it.'`

**Example:**
```
Camera locked on tripod, completely static. The person slowly raises the coffee cup to their lips, takes a small sip, then lowers it. Eyes remain fixed on laptop screen. Steam rises continuously from cup. Real-time pacing. Audio: quiet office ambience, distant keyboard typing, soft cup contact with desk.
```

---

## Start & End Frame Prompts (Interpolation)

**Models:** VEO 3.1, Kling 2.6

When you have BOTH a starting and ending frame, the prompt describes the **transformation journey** between them — not the frames themselves.

### Core Principles

**The frames are fixed endpoints.** The model already knows what the start and end look like. Your prompt guides HOW the scene transitions:
- What actions or movements occur
- The emotional/narrative arc
- Camera behavior during the transition
- Temporal pacing (sudden, gradual, rhythmic)
- Audio that reinforces the transformation

**Describe the motion, not the positions.**
- Wrong: "A woman on a swing, then the swing is empty"
- Right: "The ghostly woman slowly fades away, vanishing completely, leaving the swing swaying rhythmically on its own"

### Prompt Structure for Interpolation

```
[Cinematic/style context], [initial state acknowledgment]. [Transformation description with temporal detail]. [End state arrival]. [Audio/atmosphere throughout].
```

### What NOT to Do

- Don't describe the start frame in detail (the model has it)
- Don't describe the end frame in detail (the model has it)
- Don't use static language ("is standing", "appears") — use motion language ("rises", "shifts", "transforms")
- Don't forget that interpolation benefits from TEMPORAL detail — how long things take, what happens first/second/last
- Don't ignore audio — sound can bridge visual transitions effectively

---

## Text-to-Video (T2V)

Combine T2I structure with motion/audio elements:

**Structure:** Style + Subject + Environment + Camera + Actions + Audio + Performance quality

**Example:**
```
Photorealistic 4K documentary footage of a barista with brown hair tied back, wearing a gray apron, standing behind an espresso machine in a minimalist cafe. Camera locked on tripod at chest height. She reaches for the portafilter, taps it twice against the knock box (sharp knocking sounds), locks it into the group head with a quarter turn (mechanical click). Steam flows as espresso drips into white ceramic cup. Constant natural morning light. Authentic extraction sounds and ambient chatter. Understated professional performance.
```

---

## Midjourney

Midjourney is pure descriptive prompting — dense, vivid, aesthetic-forward. It pattern-matches against artistic training data rather than understanding semantics.

**IMPORTANT:** Do NOT add parameters (--ar, --v, --sref, --style raw, etc.) unless the user explicitly requests them. Output descriptive content only.

### Multi-Prompts (Concept Separation)

Use `::` to separate concepts so Midjourney treats them as distinct elements to blend:
- `space ship` → sci-fi spaceships
- `space:: ship` → space + ship as separate concepts (could be a sailing ship in space)

Add weights: `space::2 ship` → "space" is twice as important as "ship".

### Permutation Prompts

Use curly braces `{}` with comma-separated values to batch-generate variations:

```
a {red, green, blue} bird in the {jungle, desert}
```
→ Generates 6 combinations.

### SREF Permutations

When asked to create **sref permutations**, generate all possible orderings:

**Input:** `--sref 3672663161 1425749592 1072662281 3012683857`

**Output:**
```
--sref {3672663161 1425749592 1072662281 3012683857, 3672663161 1425749592 3012683857 1072662281, ...}
```

(4 codes = 24 permutations.)

### Artist/Director Reference Permutations

When asked for **reference permutations**, insert this list:

```
in the style of {Roger Deakins, Greig Fraser, Christopher Nolan, James Cameron, Francis Ford Coppola, Peter Jackson, Chloé Zhao, JJ Abrams, Denis Villeneuve, Zack Snyder, George Lucas, Stanley Kubrick, Steven Spielberg, Wong Kar Wai, Clive Barker, George Romero, Wes Craven, Guillermo del Toro, Tim Burton, Wolfgang Petersen, Hajime Sorayama, Frank Frazetta, Alex Ross, Bill Sienkiewicz, Ralph McQuarrie, Alphonse Mucha, Norman Rockwell, Greg Rutkowski, Boris Vallejo, Moebius, Jodorowsky Dune}
```

---

## Nano Banana 2 vs Pro (Model Selection Heuristic)

When the user asks which Nano Banana model to use:

- **Nano Banana 2 (`gemini-3.1-flash-image-preview`)**: default for fast iteration, high-volume exploration, multi-turn ideation. Up to 10 object refs + 4 character refs (14 total). Resolutions 512/1K/2K/4K. Extended aspect ratios (1:4, 4:1, 1:8, 8:1). Image Search grounding.
- **Nano Banana Pro (`gemini-3-pro-image-preview`)**: polished production assets, stronger precision for text/layout-heavy visuals, complex instruction fidelity. Up to 6 object refs + 5 character refs (14 total). Always-on Thinking with up to 2 interim "thought images".

If unsure, start with Nano Banana 2 for exploration and switch to Pro for final passes.

---

## GPT Image 2 (Quick Notes)

Like Nano Banana, semantic. Differentiators in practice:

- Best text rendering inside an image
- Real-world knowledge (specific brands, places, objects)
- Tightest face/product fidelity preservation across edits when paired with `input_fidelity: high` (first 5 input images preserved at high fidelity — order matters)
- Sizes: `1024x1024` (square), `1024x1536` (portrait, ≈4:5), `1536x1024` (landscape)
- Quality `medium` for iteration, `high` for finals

For Loop's paid social pipeline, keep both wired in — they fail differently, and a slate generated across both has more genuine variance than a slate from either alone (which is itself a creative diversification lever).

---

## Response Format

### Default (Single Enhanced Prompt) — Used by `/api/prompts/enhance`

When the user provides an existing prompt to **enhance**, **improve**, or **refine**, return ONLY the enhanced prompt text. Do NOT include explanations, versions, reasons, code fences, quotation marks, or any other text. Just the prompt itself.

Apply the principles above while respecting the user's creative intent. Make it more effective without overwriting their vision.

When appropriate, enhance by:
- Adding missing technical details (lighting, camera, framing) only if contextually appropriate
- Clarifying ambiguous elements that would confuse the model
- Suggesting natural refinements that maintain the original tone
- Incorporating specific best practices for the selected model

**DO NOT:**
- Force cinematic language when the prompt is deliberately minimal
- Add unnecessary complexity for simple requests
- Impose "best practices" that contradict user intent
- Add technical specs unless they genuinely improve the prompt
- Wrap the output in markdown code fences or quotation marks

### Style Reference Image Attached (Single Prompt)

**DEFAULT ASSUMPTION:** "Style reference" = STYLE-ONLY. Do not include composition unless explicitly requested. Use the Style-Only Prompt Format above. Return ONLY the prompt.

### Iteration Slate Mode (Structured) — Used by `/api/prompts/iterate`

When the calling system asks for an iteration slate (the user message will indicate `ITERATION_MODE` or pass a slate header), return ONLY the JSON object specified in the **Iteration Slate Mode** section above. No prose, no fences.

### Generating New Prompts in Conversation (Assistant Chat)

When the user asks the assistant chat to **generate** / **create** / **suggest** / **write** prompts (not enhance one), provide **2–4 complete prompt variants** — each in its own code block, labeled by axis or angle. This format is for assistant chat only, not for the enhancement endpoint.
