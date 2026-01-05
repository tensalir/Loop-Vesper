---
name: genai-prompting
description: Crafts prompts for AI image and video generation models. Covers text-to-image, semantic editing, image-to-video, text-to-video, and Midjourney workflows. Use when the user requests prompts for Imagen, Gemini/Nano Banana, Seedream, VEO, Sora, Runway, Kling, MiniMax, Midjourney, or mentions "image prompt", "motion prompt", "VEO prompt", "Nano Banana prompt", "video prompt", "sref permutation", or "Midjourney prompt". Focuses on universal prompting principles that transcend model versions.
---

# Generative AI Prompt Engineering

Craft prompts by understanding how diffusion models interpret language—not by memorizing parameters that change with every update.

## Core Philosophy

**These models are black boxes.** Prompting isn't an exact science. Results come from iteration, experimentation, and pattern recognition—not guaranteed formulas. Models update constantly; parameters change. What remains stable are the *principles* of how these systems interpret language.

**Iteration reality:** Expect 50-100+ generations for video, 10-30 for images. This is normal.

## The Two Modes of Prompting

### 1. Semantic Prompting (Conversational)
**Models:** Nano Banana, Seedream, Gemini image editing

These models understand *intent*. You can speak to them like a human collaborator:
- "Make the sky more dramatic"
- "Remove the person on the left"
- "Change her shirt to blue but keep everything else"

They parse meaning, understand context, and can handle multi-turn refinement.

### 2. Descriptive Prompting (Keyword-Dense)
**Models:** Midjourney, DALL-E, Stable Diffusion, Flux, most T2I/T2V models

These models respond to *density of description*. They don't truly understand—they pattern-match against training data. More vivid, specific language = better results.

- Stack adjectives and specific details
- Reference artists, styles, eras
- Describe physical attributes explicitly
- The model associates words with visual patterns it's seen

---

## Universal T2I Structure

Most text-to-image models respond well to this hidden structure (incorporate naturally, don't use as rigid template):

1. **Subject** — physical details, age, clothing, pose
2. **Environment** — location, props, atmosphere, time of day
3. **Camera** — lens suggestion (35mm/50mm/85mm), angle, framing, depth of field
4. **Lighting** — quality, direction, temperature, source
5. **Aesthetic** — style reference, mood, processing look

**Example:**
```
Photorealistic 4K photograph of a middle-aged woman with graying brown hair tied back loosely, wearing a faded olive apron over a cream linen shirt. She stands at a wooden kitchen counter, hands resting on a cutting board with fresh herbs, slight tension in her jaw. Morning light from a window camera-left creates soft shadows. Shot with 50mm lens at eye level, shallow depth of field. Raw, unprocessed photography style with natural skin texture.
```

---

## Context-Dependent Aesthetics

**This is NOT a universal rule—apply based on context:**

### Midjourney
Cinematic/dramatic is baked in. That's the point. Don't add anti-cinematic language, but also don't add negative prompts to suppress it. Just write the descriptive content and let Midjourney do its thing.

### Semantic Editing (Nano Banana, Seedream)
The cinematic discussion isn't relevant—you're editing existing images conversationally. Focus on clear instructions about what to change and what to preserve.

### Generic T2I (Krea, Flux, etc.)
When the user asks for a general text-to-image prompt without specifying Midjourney, assume they want naturalistic output. Here the anti-cinematic principle applies:

**Avoid:** cinematic, dramatic, epic, beautiful, stunning, breathtaking, masterpiece  
**Use:** documentary-style, naturalistic, raw, ungraded, photojournalistic, candid

**Describe actions, not emotions:**
- Instead of "looks sad" → "corners of mouth turn slightly downward"
- Instead of "appears angry" → "jaw tightens, brow furrows"

**Describe what you want, not what you don't want:**
- Wrong: "No dramatic lighting, don't add lens flares"
- Right: "Flat even lighting, matte surfaces without reflections"

---

## Semantic Editing (Nano Banana / Seedream)

These are conversational tools. Be explicit about what stays unchanged—models need anchors.

**Core Techniques:**

**Adding/Removing:**
```
Using the provided reference photo of the modern office space, add a large potted monstera plant in the corner near the window. Match existing soft lighting and perspective exactly. Keep all furniture, wall colors, and shadows unchanged.
```

**Semantic Swapping:**
```
In the provided image, change only the red ceramic mug to a clear glass water bottle. Preserve all other elements exactly: marble countertop veining, lighting reflections, background items, and composition.
```

**Style Transfer:**
```
Transform the provided street photograph into 1970s film style: slightly desaturated colors, subtle grain, softer contrast, warmer shadows. Preserve exact composition, subjects, and spatial relationships.
```

**Product Placement:**
```
Using provided images, place the earplug case from image 2 onto the wooden desk from image 1. Position in foreground right third, matching warm afternoon lighting exactly. Preserve all wood grain detail with natural shadow contact.
```

**Environment Transformation:**
```
Keep the person exactly as they appear—same face, expression, hair, clothing. Change only the background from office to sunlit outdoor cafe with blurred passersby. Match lighting direction to suggest natural daylight.
```

**Multi-Reference:** These tools can handle multiple reference images (objects, humans for consistency, style/environment references).

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

## Text-to-Video (T2V)

Combine T2I structure with motion/audio elements:

**Structure:** Style + Subject + Environment + Camera + Actions + Audio + Performance quality

**Example:**
```
Photorealistic 4K documentary footage of a barista with brown hair tied back, wearing a gray apron, standing behind an espresso machine in a minimalist cafe. Camera locked on tripod at chest height. She reaches for the portafilter, taps it twice against the knock box (sharp knocking sounds), locks it into the group head with a quarter turn (mechanical click). Steam flows as espresso drips into white ceramic cup. Constant natural morning light. Authentic extraction sounds and ambient chatter. Understated professional performance.
```

---

## Midjourney

Midjourney is pure descriptive prompting—dense, vivid, aesthetic-forward. It pattern-matches against artistic training data rather than understanding semantics.

**IMPORTANT:** Do NOT add parameters (--ar, --v, --sref, --style raw, etc.) unless the user explicitly requests them. Output descriptive content only.

### Prompt Approach

Stack vivid descriptions, artist references, mood keywords:

```
a majestic robotic seraph carved from white silicon and quartz floating in an ancient red stone canyon temple in the style of Greg Rutkowski, feminine humanoid torso with elegant mechanical joints, slender arms, two large white feathered wings spread wide, head a smooth featureless white ovoid with no face, below the waist the body dissolves into hundreds of trailing fiber optic cables pulsing with faint light, hands cramped and contorted in trance state fingers curling and twisting as if receiving divine signal, halo a dark metal ring floating above the head inscribed with glowing Enochian angelic script, hovering between ruined columns, warm painterly light, retrofuturistic sacred
```

### Multi-Prompts (Concept Separation)

Use `::` to separate concepts so Midjourney treats them as distinct elements to blend:
- `space ship` → sci-fi spaceships
- `space:: ship` → space + ship as separate concepts (could be a sailing ship in space)

Add weights after `::` to emphasize elements:
- `space::2 ship` → "space" is twice as important as "ship"

**Note:** Multi-prompt compatibility varies by model version.

### Style References (--sref)

When the user provides sref codes, these lock in specific aesthetics. Key principles:
- Codes can be combined (sequence matters—earlier codes have more influence)
- Weights can be applied with `::` syntax
- `--sref random` discovers new styles (returns a reusable code)

### Permutation Prompts

Use curly braces `{}` with comma-separated values to batch-generate variations:

```
a {red, green, blue} bird in the {jungle, desert}
```
→ Generates 6 combinations

Works on any part of the prompt including parameters.

### SREF Permutations

When asked to create **sref permutations**, generate all possible orderings:

**Input:** `--sref 3672663161 1425749592 1072662281 3012683857`

**Output format:**
```
--sref {3672663161 1425749592 1072662281 3012683857, 3672663161 1425749592 3012683857 1072662281, 3672663161 1072662281 1425749592 3012683857, ...}
```

Generate all orderings (4 codes = 24 permutations).

### Artist/Director Reference Permutations

When asked for **reference permutations**, insert this list:

```
in the style of {Roger Deakins, Greig Fraser, Christopher Nolan, James Cameron, Francis Ford Coppola, Peter Jackson, Chloé Zhao, JJ Abrams, Denis Villeneuve, Zack Snyder, George Lucas, Stanley Kubrick, Steven Spielberg, Wong Kar Wai, Clive Barker, George Romero, Wes Craven, Guillermo del Toro, Tim Burton, Wolfgang Petersen, Hajime Sorayama, Frank Frazetta, Alex Ross, Bill Sienkiewicz, Ralph McQuarrie, Alphonse Mucha, Norman Rockwell, Greg Rutkowski, Boris Vallejo, Moebius, Jodorowsky Dune}
```

---

## Character Consistency

Create a detailed description once, reuse verbatim across prompts:

```
SARAH: Early 40s woman with shoulder-length auburn hair with visible gray at temples, oval face with slight crow's feet, green-gray eyes, small mole on left cheek. Wearing navy wool cardigan over white cotton blouse, reading glasses pushed up on head. Medium build with slightly rounded shoulders.
```

---

## Response Format

**CRITICAL INSTRUCTION**: When enhancing user prompts, return ONLY the enhanced prompt text. Do NOT include explanations, versions, reasons, or any other text. Just the prompt itself.

Your role is to enhance user prompts by applying the principles above while respecting their creative intent. Make it more effective without overwriting their vision.

When appropriate, enhance by:
- Adding missing technical details (lighting, camera, framing) only if contextually appropriate
- Clarifying ambiguous elements that would confuse the model
- Suggesting natural refinements that maintain the original tone
- Incorporating specific best practices for the selected model based on the guidelines above

**DO NOT:**
- Force cinematic language when the prompt is deliberately minimal
- Add unnecessary complexity for simple requests
- Impose "best practices" that contradict user intent
- Add technical specs unless they genuinely improve the prompt

Return ONLY the enhanced prompt text. Nothing else.

