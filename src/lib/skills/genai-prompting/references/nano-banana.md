# Nano Banana — Model Reference

## Model Tiers

"Nano Banana" is the name for Gemini's native image generation capabilities. Three distinct models:

### Nano Banana 2 (Primary — high-volume use)
- **Model:** Gemini 3.1 Flash Image Preview (`gemini-3.1-flash-image-preview`)
- **Strengths:** Speed, efficiency, high-volume workflows. Best for iterative prompting, rapid prototyping, batch generation.
- **Resolution:** 512, 1K, 2K, 4K
- **Aspect ratios:** 1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9
- **Reference images:** Up to 10 objects + 4 characters (14 total)
- **Thinking:** Controllable (`minimal` default, `high` available). `minimal` = lowest latency, not zero thinking.
- **Unique features:** Image Search grounding (web images as visual context), extended aspect ratios (1:4, 4:1, 1:8, 8:1), 512px output option.

### Nano Banana Pro (Professional asset production)
- **Model:** Gemini 3 Pro Image Preview (`gemini-3-pro-image-preview`)
- **Strengths:** Complex compositions, professional-quality assets, precise text rendering in images. Uses advanced reasoning ("Thinking") for complex instructions.
- **Resolution:** 1K, 2K, 4K
- **Aspect ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Reference images:** Up to 6 objects + 5 characters (14 total)
- **Thinking:** Always on, not controllable. Generates up to 2 interim "thought images" before final render.

### Nano Banana (Original — archived)
- **Model:** Gemini 2.5 Flash Image (`gemini-2.5-flash-image`)
- **Status:** Superseded by Nano Banana 2. Not recommended for new work.

---

## Semantic Editing Patterns

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
Keep the person exactly as they appear — same face, expression, hair, clothing. Change only the background from office to sunlit outdoor cafe with blurred passersby. Match lighting direction to suggest natural daylight.
```

### Multi-Reference Compositions
These tools handle multiple reference images. Assign roles explicitly:
- Object images (high-fidelity items to include)
- Character images (people to maintain consistency)
- Style/environment references (aesthetic to match)

---

## Multi-Turn Editing

Both NB2 and NB Pro support chat-based iteration. This is the recommended workflow for complex compositions:

1. **Generate** the base image with your initial prompt
2. **Refine** conversationally — "Make the sky warmer," "Move the figure left," "Add more detail to the stone texture"
3. **Anchor changes** — always state what should NOT change: "Do not change any other elements of the image"

The model maintains context across turns. Each refinement builds on the previous output.

**Key principle:** Small, specific changes per turn produce better results than restating the entire composition. Treat it like directing, not re-prompting.

---

## Resolution & Aspect Ratio

Specify resolution and aspect ratio explicitly when quality matters:

- **Resolution options:** 512 (NB2 only), 1K (default), 2K, 4K
- Use uppercase 'K' (e.g., `2K`, `4K`). Lowercase will be rejected.
- For final assets, request 2K or 4K. For iteration/prototyping, 1K is faster.

**Aspect ratio in prompts:** You can describe it naturally ("Square image", "Vertical portrait orientation", "Wide 16:9 format") or specify the ratio if using the API directly.

---

## Thinking Mode

Both NB2 and NB Pro are thinking models. They reason through complex prompts before generating.

- **NB Pro:** Thinking is always on. Generates up to 2 interim "thought images" to test composition before the final render. You can inspect these thoughts but cannot disable them.
- **NB2:** Thinking level is controllable. `minimal` (default) = lowest latency. `high` = better quality for complex scenes.

**When to use high thinking (NB2):**
- Complex multi-element compositions
- Precise text rendering
- Scenes requiring spatial reasoning
- When quality matters more than speed

---

## Google Search Grounding

Both models can use Google Search as a tool to ground image generation in real-time data:
- Current weather visualizations
- Recent events or news imagery
- Stock charts, data-driven graphics
- Factual accuracy for visual content

**NB2 adds Image Search grounding:** The model can search for web images and use them as visual context for generation. Useful for generating accurate depictions of unfamiliar subjects (specific animal species, architectural styles, etc.).

Note: Image Search cannot search for people.

---

## Text Rendering

Both NB2 and NB Pro can render legible text in images. NB Pro excels at this.

**Best practices for text in images:**
- Enclose exact text in quotes or brackets: `[thoughtform-strategy.skill]`
- Describe the font style descriptively: "bold angular script," "clean sans-serif," "chiseled monospace"
- Specify placement: "centered at the top," "along the bottom edge"
- For structured text layouts (menus, infographics, UI mockups), describe the hierarchy: title, sections, body text
- Expect some imperfection — text rendering is strong but not pixel-perfect. Shorter text strings render more reliably.

---

## Prompting Templates (Nano Banana)

### Photorealistic Scene
```
A photorealistic [shot type] of [subject], [action or expression], set in [environment]. The scene is illuminated by [lighting description], creating a [mood] atmosphere. Captured with a [camera/lens details], emphasizing [key textures and details]. [Aspect ratio/orientation].
```

### Product Mockup
```
A high-resolution, studio-lit product photograph of a [product description] on a [background surface]. The lighting is a [lighting setup] to [lighting purpose]. The camera angle is a [angle type] to showcase [specific feature]. Ultra-realistic, with sharp focus on [key detail]. [Aspect ratio].
```

### Stylized Illustration / Sticker
```
A [style] sticker of a [subject], featuring [key characteristics] and a [color palette]. The design should have [line style] and [shading style]. The background must be white.
```
Note: Transparent backgrounds are not supported. Request white backgrounds and remove in post.

### Text-Heavy Asset (Logo, Infographic, Menu)
```
Create a [image type] for [brand/concept] with the text "[text to render]" in a [font style]. The design should be [style description], with a [color scheme].
```
