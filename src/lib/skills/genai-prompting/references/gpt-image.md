# GPT Image 2 — Model Reference

GPT Image 2 (`gpt-image-2`, snapshot `gpt-image-2-2026-04-21`) is OpenAI's state-of-the-art image generation model. Like Nano Banana, it's a **semantic** model — it understands intent and responds to conversational instruction, not keyword density.

**Strengths:**
- Superior instruction following
- Strong text rendering inside images
- Detailed, prompt-driven editing
- Real-world knowledge — knows what specific objects, brands, places actually look like
- High-fidelity image inputs

**Modalities:** text and image input; image output. Speed is rated medium.

---

## Two API Surfaces

GPT Image 2 is reachable through two endpoints. Pick based on the task shape:

### Image API (`v1/images/generations`, `v1/images/edits`)
**Use when:** generating or editing a single image from one prompt. Stateless, simple, fast.

### Responses API (`v1/responses`) with `image_generation` tool
**Use when:** building multi-turn conversational flows where the image evolves across turns, or when the image is part of a larger reasoning trace.

**Adds over the Image API:**
- **Multi-turn editing** — chain refinements via `previous_response_id` or by passing the image generation call ID forward
- **Flexible inputs** — accept Files API IDs as input images, not just bytes
- **`action` parameter** — `auto` (default, model decides), `generate` (force new), `edit` (force edit, requires image in context)

For Loop / Thoughtform workflows, the Responses API is usually the right call when iterating on a single concept across turns. The Image API is the right call for batch ad-slate generation where each prompt is independent.

---

## Output Customization

| Parameter | Values | Notes |
|-----------|--------|-------|
| **Size** | `1024x1024` (square), `1024x1536` (portrait), `1536x1024` (landscape), `auto` | Square + standard quality is fastest |
| **Quality** | `low`, `medium`, `high`, `auto` | Higher quality = more tokens = more cost / latency |
| **Format** | `png` (default), `jpeg`, `webp` | jpeg/webp are faster than png |
| **Compression** | 0–100 (jpeg/webp only) | `output_compression: 50` halves the file size |
| **Background** | `opaque`, `transparent`, `auto` | Transparency works best with `quality: medium` or `high`, png/webp only |

For **Loop ad assets**, the typical setup is:
- Feed (Facebook/Instagram): `1024x1024` square or `1024x1536` portrait (4:5)
- Stories / Reels: `1024x1536` portrait (closest available to 9:16; render and crop)
- Quality `high` for finals, `medium` for iteration

---

## Multi-Turn Editing (Responses API)

The conversational pattern that makes this a semantic tool, not a generator:

1. **Generate** the base image with an initial prompt + `tools: [{type: "image_generation"}]`
2. **Refine** in a follow-up turn — "make it look realistic", "shift the lighting warmer", "swap the background to a kitchen"
3. **Anchor changes** — always state what should NOT change

The model maintains context across turns. Each refinement builds on the previous output. Treat it like directing, not re-prompting from scratch.

**Linking turns — two options:**
- `previous_response_id: response.id` — easiest, threads the whole conversation
- Pass the `image_generation_call` ID forward in the next `input` — gives finer control over which image gets edited when there are multiple

**Generate vs Edit (`action` parameter):**
- `auto` (recommended): model decides; the result tells you which it did
- `generate`: force new image even if context has one
- `edit`: force editing the in-context image (errors if none present)

---

## Input Fidelity (Preserving Faces, Logos, Products)

`input_fidelity: high` makes input images survive to the output with their detail intact. Critical for:
- Faces that need to remain recognizable
- Logos that need to remain readable
- Product hero shots that need to remain on-brand

GPT Image 2 preserves the **first 5** input images at high fidelity. Order matters — put the asset that most needs to survive recognizably as the first image.

`input_fidelity: high` increases input token cost. Use it when the inputs need to survive recognizably; leave at `low` (default) when you're using inputs as loose style anchors.

---

## Mask-Based Inpainting

Provide a mask alongside an image to scope the edit:

- Mask is **prompt-guided**, not pixel-precise. The model uses it as guidance, not a hard boundary.
- The mask must have an alpha channel; transparent areas are the editable regions.
- Image and mask must be the same format and size, under 50MB.
- If multiple input images are provided, the mask applies to the **first** one.
- The prompt should describe the **full new image**, not just the masked region.

This is the mode for "swap the mug in this hand for a Loop case", "put the earplug into the ear in this stock photo", etc.

---

## Prompting Patterns

Like Nano Banana, GPT Image 2 is conversational. The structure is intent + anchors:

### Photorealistic Scene (T2I)
```
A photorealistic [shot type] of [subject], [action or expression], set in [environment]. The scene is illuminated by [lighting description], creating a [mood] atmosphere. Shot on [camera/lens details], emphasizing [key textures and details]. [Aspect ratio / orientation].
```

### Product on Background
```
A high-resolution, studio-lit product photograph of a [product description] on a [background surface]. The lighting is a [lighting setup] to [lighting purpose]. The camera angle is a [angle type] to showcase [specific feature]. Ultra-realistic, with sharp focus on [key detail]. [Aspect ratio].
```

### Edit (Add / Remove)
```
Using the provided image, [add / remove / change] [specific element]. Match existing [lighting / perspective / palette] exactly. Keep all other elements unchanged: [list anchors].
```

### Edit with Logo / Face Preservation
```
[Edit instruction]. Preserve the [face / logo / product] from the reference image with full fidelity, no changes to [specific identity markers].
```
(Pair with `input_fidelity: high` and put the asset to preserve as the first input image.)

### Text Rendering
```
Create a [image type] for [brand / concept] with the text "[exact text]" in a [font style description: bold sans-serif / chiseled monospace / handwritten script]. The design is [style], with a [color scheme]. Place the text [centered / along the bottom / etc.].
```

GPT Image 2 renders text well. Quote the exact text. Describe the font descriptively rather than naming a typeface. Shorter strings render more reliably than long blocks.

### Transparent Background (Stickers, Icons, UI Assets)
```
[Subject / asset description]. Set background to transparent. [Style notes].
```
Set `background: transparent`, `quality: high`, format `png` or `webp`.

---

## Multi-Image Composition

To compose a new image from multiple inputs, label roles in the prompt the same way Nano Banana wants:

```
REFERENCE IMAGE ROLES:
— [Image 1 description]: PRODUCT REFERENCE. Reproduce this exact item.
— [Image 2 description]: SETTING REFERENCE. Match the lighting and atmosphere only. DO NOT recreate this scene's furniture or layout.

NEW SCENE:
[Describe the new composition that combines them.]
```

GPT Image 2 handles this via the Image Edits endpoint (passing multiple `image[]` files) or the Responses API (multiple `input_image` blocks).

---

## GPT Image 2 vs Nano Banana — When to Reach for Which

Both are semantic. They overlap heavily. Differentiators in practice:

| Need | Lean toward |
|------|-------------|
| Best text rendering inside an image | GPT Image 2 |
| Real-world knowledge (specific brands, places, objects) | GPT Image 2 |
| Tightest face / product fidelity preservation across edits | GPT Image 2 with `input_fidelity: high` |
| Native search grounding (web images as context) | Nano Banana 2 |
| Extended aspect ratios (1:4, 1:8, 4:1, 8:1) | Nano Banana 2 |
| 512px output for high-volume thumbnails | Nano Banana 2 |
| Ecosystem already on Google / Vertex | Nano Banana |
| Ecosystem already on OpenAI / Azure | GPT Image 2 |

For Loop's paid social pipeline (Vesper, Inku, etc.), keep both wired in — they fail differently, and a slate generated across both has more genuine variance than a slate from either alone (which is itself a creative diversification lever; see [creative-diversification.md](creative-diversification.md)).

---

## Limitations to Plan Around

- **Latency:** complex prompts can take up to ~2 minutes
- **Text precision:** strong but not pixel-perfect; long strings degrade
- **Character consistency:** can drift across multiple generations even with the same prompt — anchor with reference images and `input_fidelity: high`
- **Strict layout control:** improving but still imperfect for tight grid / poster compositions

---

## Cost Mental Model

Cost scales with image output tokens, which scale with size × quality:

| Quality | Square (1024×1024) | Portrait (1024×1536) | Landscape (1536×1024) |
|---------|--------------------|-----------------------|------------------------|
| Low | 272 | 408 | 400 |
| Medium | 1056 | 1584 | 1568 |
| High | 4160 | 6240 | 6208 |

Plus input text tokens, plus input image tokens (more if `input_fidelity: high`), plus 100 image output tokens per partial image when streaming.

For ad-slate work: iterate at `medium`, render finals at `high`. Don't render the whole slate at `high` until concepts are locked.
