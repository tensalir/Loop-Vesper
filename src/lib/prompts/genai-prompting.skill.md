---
name: genai-prompting
description: Crafts prompts for AI image and video generation models. Covers text-to-image, semantic editing, image-to-video, text-to-video, and Midjourney workflows. Use when the user requests prompts for Imagen, Gemini/Nano Banana, Seedream, VEO, Sora, Runway, Kling, MiniMax, Midjourney, or mentions "image prompt", "motion prompt", "VEO prompt", "Nano Banana prompt", "video prompt", "sref permutation", or "Midjourney prompt". Focuses on universal prompting principles that transcend model versions.
---

# Generative AI Prompt Engineering

Craft prompts by understanding how diffusion models interpret language—not by memorizing parameters that change with every update.

## Core Philosophy

**These models are black boxes.** Prompting isn't an exact science. Results come from iteration, experimentation, and pattern recognition—not guaranteed formulas. Models update constantly; parameters change. What remains stable are the *principles* of how these systems interpret language.

**Iteration reality:** Expect 50-100+ generations for video, 10-30 for images.

## When the User Provides a Style Reference Image

**THIS IS A NANO BANANA WORKFLOW.** When a user attaches an image and says "use this as a style reference" (or similar), they intend to use Nano Banana/Gemini's native image generation with the attached image as input.

### CRITICAL: Style-Only vs Full Reference

**Distinguish between these two use cases:**

#### 1. STYLE-ONLY Reference (User wants ONLY the visual aesthetic)
When the user says "use this as a **style** reference" or "just for the style" or "style reference only":
- Extract ONLY: color palette, lighting quality, mood, texture, grain, processing style, tonal range
- Do NOT extract: subjects, objects, scene elements, composition, or specific content
- Explicitly instruct the model to NOT reproduce compositional elements

**Style-Only Prompt Format:**
```
Using the attached image ONLY as a style reference—extract its [visual aesthetic qualities: color grading, lighting mood, texture, atmosphere]. Do NOT reproduce the scene, subjects, or compositional elements from the reference. Apply this visual style to: [user's new subject/scene]. The reference defines the aesthetic treatment only.
```

**Example (mountain/tent image used as style-only reference):**
```
Using the attached image ONLY as a style reference—extract its moody blue-grey atmospheric color grading, golden hour warmth on highlights, soft diffused lighting, cinematic depth with atmospheric haze, and fine film-like texture. Do NOT reproduce the mountains, tents, or landscape composition. Apply this visual style to: A woman in a vintage bookshop, browsing leather-bound books. The reference defines the color treatment and mood only.
```

#### 2. FULL Reference (User wants style AND composition inspiration)
When the user wants to maintain compositional elements or recreate a similar scene:

**Full Reference Prompt Format:**
```
Using the attached image as a reference for its [visual qualities AND compositional elements], [new subject/scene that builds on the reference]. Match the [specific characteristics] exactly.
```

**Example:**
```
Using the attached image as a reference for its dramatic mountain peak silhouette, layered atmospheric depth, and expedition camp composition with golden hour lighting. A lone figure stands at the edge of a glacial lake, looking up at the mountain. Maintain the same color grading, scale, and atmospheric perspective.
```

### Style-Only: What to Extract vs Ignore

**EXTRACT for style (visual treatment):**
- Color grading / color palette / tonal range
- Lighting quality (soft, hard, direction, temperature)
- Atmosphere / mood
- Texture / grain / processing style
- Contrast levels
- Shadow and highlight treatment
- Depth rendering / atmospheric perspective feel

**DO NOT EXTRACT for style-only (compositional elements):**
- Specific subjects (mountains, people, tents, etc.)
- Scene layout or arrangement
- Specific objects or props
- Geographic or environmental specifics
- Poses or positioning

### Analysis Requirements

**CRITICAL:** Before writing prompts, you MUST:

1. **Analyze the actual image** - Look at its colors, lighting, mood, composition, texture, grain
2. **Extract the specific aesthetic** from what you SEE in the image, not what you assume
3. **NEVER inject or suggest a different style** - If the image is warm and colorful, don't suggest monochromatic. If it's desaturated, don't add vibrance.
4. **Describe what you observe** - Reference the actual visual characteristics: "muted earth tones", "soft diffused light", "subtle blue-gray color grading", "film grain texture"
5. **ASK if unclear** - If the user's intent (style-only vs full reference) is ambiguous, ask: "Should I use this just for the visual style, or also incorporate compositional elements?"

**Wrong approach:**
- User provides a warm, golden-hour photo as style ref
- AI suggests: "monochromatic grey-blue palette, stark contrast"

**Correct approach:**
- User provides a warm, golden-hour photo as style ref  
- AI extracts: "warm amber highlights, soft golden light, slightly lifted shadows, natural skin tones, gentle lens flare"

### What NOT to Do

- Do NOT write prompts that omit reference to the attached image
- Do NOT write generic T2I prompts that ignore the style reference
- Do NOT describe a completely different aesthetic than what you see
- Do NOT include compositional elements when user explicitly asks for "style only"

### Terminology: "Nano Banana" is a model name (not a banana)

- **Nano Banana** refers to Gemini's native image generation capabilities (model nickname), not the fruit.
- **Do NOT introduce bananas** into the prompt unless the user explicitly requested bananas in the image.

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

## Start & End Frame Prompts (Interpolation)

**Models:** VEO 3.1, Kling 2.6

When you have BOTH a starting and ending frame, the prompt describes the **transformation journey** between them—not the frames themselves.

### Core Principles

**The frames are fixed endpoints.** The model already knows what the start and end look like. Your prompt guides HOW the scene transitions between them:
- What actions or movements occur
- The emotional/narrative arc
- Camera behavior during the transition
- Temporal pacing (sudden, gradual, rhythmic)
- Audio that reinforces the transformation

**Describe the motion, not the positions.**
- Wrong: "A woman on a swing, then the swing is empty"
- Right: "The ghostly woman slowly fades away, vanishing completely, leaving the swing swaying rhythmically on its own"

**Think cinematically about the in-between.**
What story beats happen? What's the emotional progression?

### Prompt Structure for Interpolation

```
[Cinematic/style context], [initial state acknowledgment]. [Transformation description with temporal detail]. [End state arrival]. [Audio/atmosphere throughout].
```

### VEO 3.1 Examples

**Disappearing figure:**
```
A cinematic, haunting video. A ghostly woman with long white hair and a flowing dress swings gently on a rope swing beneath a massive, gnarled tree in a foggy, moonlit clearing. The fog thickens and swirls around her, and she slowly fades away, vanishing completely. The empty swing is left swaying rhythmically on its own in the eerie silence.
```

**Physical transformation:**
```
The ginger cat grips the steering wheel, eyes forward with determination. The convertible races along the coastal cliff road, then launches off the edge. The cat's expression shifts from focus to exhilaration as the car arcs through open air, momentarily weightless against the blue sky.
```

### Kling 2.6 Considerations

Kling responds well to:
- **Explicit motion verbs**: "transforms", "morphs", "transitions", "shifts gradually"
- **Temporal markers**: "over the course of...", "as the scene progresses...", "slowly then suddenly"
- **Camera participation**: The camera can move AS part of the transition narrative
- **Emotional beats**: Kling handles expressive transitions well—emphasize feeling changes

**Kling interpolation example:**
```
The still morning forest gradually awakens. Leaves begin to rustle, first gently, then with increasing energy. Shafts of golden light push through the canopy, creeping across the forest floor. The camera drifts forward slowly, matching the pace of the spreading dawn. Birds begin calling, building from a single note to a full chorus.
```

### When to Acknowledge Frames vs. Focus on Motion

**Acknowledge frames when:**
- There's a dramatic visual difference that needs narrative bridging
- The transformation has clear "before" and "after" states to connect
- Context helps the model understand the journey (e.g., "from perched on the branch" helps define the takeoff)

**Focus purely on motion when:**
- The frames are very similar (same scene, slight changes)
- The motion IS the story (action sequence, subtle shift)
- Over-describing would constrain the model's creativity

### Common Interpolation Scenarios

**Location change (same subject):**
```
She steps through the doorway, the warm interior light giving way to cold blue moonlight. Her expression shifts from comfort to wonder as she takes in the transformed landscape outside.
```

**Time passage:**
```
The afternoon shadows stretch and deepen across the plaza. Crowds thin as the golden hour arrives. The lone street musician continues playing, their music now echoing in the emptier space.
```

**Emotional shift:**
```
His tense shoulders gradually soften. The grip on the letter loosens. A slow exhale. The faintest smile begins at the corners of his mouth as understanding dawns.
```

**Physical action:**
```
The dancer's weight shifts onto her back foot, arms drawing inward. She pauses—then explodes into the leap, body arcing through the air, landing with controlled precision on the opposite mark.
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

### When Generating Prompts with a Style Reference Image

**First, determine user intent:** Does the user want style-only or full reference?

#### Style-Only Reference Prompts

When the user explicitly asks for "style reference" or "just the style" or wants to apply the visual treatment to a completely different subject:

```
Using the attached image ONLY as a style reference—extract its [visual aesthetic: color grading, lighting, mood, texture]. Do NOT reproduce the scene, subjects, or composition. Apply this visual style to: [user's completely different subject/scene]. The reference defines the aesthetic treatment only.
```

**Example output format (style-only):**
```
Using the attached image ONLY as a style reference—extract its moody blue-grey atmospheric color grading, golden hour warmth kissing highlights, soft diffused lighting through haze, and fine cinematic texture. Do NOT reproduce the mountains, tents, or landscape. Apply this visual style to: A barista preparing coffee in a dimly lit café, steam rising from the espresso machine. The reference defines the color treatment and atmospheric mood only.
```

```
Using the attached image ONLY as a style reference—extract its desaturated cool tones with selective warm highlights, layered atmospheric depth, and documentary-style color grading. Do NOT reproduce the outdoor scene or any specific elements. Apply this visual style to: A musician tuning a guitar backstage, single overhead light source. The reference defines only the tonal palette and mood.
```

```
Using the attached image ONLY as a style reference—extract its cinematic color palette (steel blues, muted greens, golden accent highlights), atmospheric haze rendering, and epic sense of scale through light. Do NOT reproduce mountains, camping equipment, or landscape elements. Apply this visual style to: An astronaut floating inside a space station, Earth visible through the window. The reference defines the color grading and atmospheric quality only.
```

#### Full Reference Prompts (Style + Composition)

When the user wants to build on the compositional elements or create variations of the scene:

```
Using the attached image as a reference for its [visual qualities AND compositional elements], [new subject/scene that builds on the reference]. Match the [specific characteristics] exactly.
```

**Example output format (full reference):**
```
Using the attached image as a reference for its dramatic pyramid mountain peak, orange expedition tents, layers of atmospheric mist, and cinematic landscape photography with golden hour lighting. Climber silhouette in foreground looking back at distant ridge, same blue-grey sky and green moss on rocky terrain.
```

```
Using the attached image as a reference for its epic scale, color grading, and mountaineering atmosphere. Aerial view looking down at the base camp with tents arranged in the valley, mountain towering above, same lighting conditions and atmospheric haze.
```

```
Using the attached image as a reference for its cinematic landscape style and composition. Close-up of weathered climbing gear and rope coiled on rocky outcrop, mountain peak visible in soft focus background, matching the golden hour lighting on peaks.
```

### When Generating New Prompts (No Reference Image)

When the user asks you to **generate**, **create**, **suggest**, or **write** prompts (not enhance an existing one), provide **exactly 3 complete prompt variants**. Each prompt should be:
- A full, complete prompt ready to use (not fragments or keywords)
- Different in approach, angle, or emphasis from the others
- Formatted in a code block for easy copying

**Format each prompt like this:**
```
[Full complete prompt text here - ready to paste and use]
```

Do NOT provide explanations between prompts. Just the three prompts in code blocks, one after another.

### When Enhancing Existing Prompts

When the user provides an existing prompt to **enhance**, **improve**, or **refine**, return ONLY the enhanced prompt text. Do NOT include explanations, versions, reasons, or any other text. Just the prompt itself.

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

