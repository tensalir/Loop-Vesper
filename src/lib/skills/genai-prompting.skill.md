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

## Context-Dependent Aesthetics

### Midjourney
Cinematic/dramatic is baked in. Don't suppress it, don't amplify it. Just write descriptive content. See [references/midjourney.md](references/midjourney.md) for MJ-specific techniques.

### Semantic Models (Nano Banana, GPT Image)
The cinematic discussion isn't relevant — work conversationally. Focus on clear intent about what to create, change, or preserve.
- Nano Banana 2 / Pro details: [references/nano-banana.md](references/nano-banana.md)
- GPT Image 2 details: [references/gpt-image.md](references/gpt-image.md)

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

## Character Consistency

Create a detailed description once, reuse verbatim across prompts:

```
SARAH: Early 40s woman with shoulder-length auburn hair with visible gray at temples, oval face with slight crow's feet, green-gray eyes, small mole on left cheek. Wearing navy wool cardigan over white cotton blouse, reading glasses pushed up on head. Medium build with slightly rounded shoulders.
```

When character reference images are available (Nano Banana 2/Pro, GPT Image 2 with `input_fidelity: high`), combine the image reference with minimal text anchors instead of re-describing what's visible.

---

## Iteration & Variation (Ad Sets, Slates, A/B Series)

When the task is a **slate of variations** rather than a single image — paid social, ad sets, A/B testing, campaign creative — the prompting craft is necessary but not sufficient. The slate has to be diversified along the right axes, or it won't survive Meta's Andromeda retrieval (or any modern ranking system that rewards genuine creative diversity).

The shorthand: **same theme, meaningfully different execution.** Two photos of the same product on different backgrounds is weak diversification. A testimonial, a pain-point hook, and a demo across the same offer is real diversification.

For the full workflow — diversification axes, the weak/strong test, and the prompt-slate pipeline — see [references/creative-diversification.md](references/creative-diversification.md). Read this whenever the user asks for ad variations, ad set creative, "different versions" of an ad, or anything Meta / paid-social shaped.

---

## Video Prompting

See [references/video.md](references/video.md) for image-to-video and text-to-video prompting.

---

## Model-Specific References

- **Nano Banana 2 & Pro** — [references/nano-banana.md](references/nano-banana.md)
  Tiers, semantic editing, multi-turn workflows, resolution/aspect ratio, thinking mode, search grounding
- **GPT Image 2 (gpt-image-2)** — [references/gpt-image.md](references/gpt-image.md)
  Image API vs Responses API, multi-turn editing, input fidelity, sizes/quality/formats, mask-based inpainting, prompting patterns, differences vs Nano Banana
- **Midjourney** — [references/midjourney.md](references/midjourney.md)
  Multi-prompts, style references, permutations, artist/director lists
- **Video (I2V/T2V)** — [references/video.md](references/video.md)
  Motion prompts, static camera escalation, audio design, T2V structure
- **Creative Diversification (Andromeda-aware)** — [references/creative-diversification.md](references/creative-diversification.md)
  Diversification axes, weak/strong test, prompt-slate pipeline for ad sets

---

## Response Format

For **single prompts**, provide 2–4 variants in SEPARATE code boxes:

```
Here are [N] optimized [workflow type] prompts:

**Version 1 — [Label]:**

[prompt in code box]

**Version 2 — [Alternative]:**

[prompt in code box]

**Technical Notes:**
- [Why specific choices improve results]
- [Expected iterations]
```

For **diversified slates** (ad sets, variation series), follow the slate format in [references/creative-diversification.md](references/creative-diversification.md) — each prompt labeled with its angle/axis, not just a version number, so the diversification logic is legible at a glance.

**CRITICAL:** Each prompt in its OWN code box. Never combine variants. Never use quotation marks around prompts.
