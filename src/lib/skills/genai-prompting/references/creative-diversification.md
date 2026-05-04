# Creative Diversification — Ad Slates & Iteration

How to turn a single concept into a slate of meaningfully different ads. Use this whenever the task is multiple ads in one ad set, paid social variation series, or A/B creative testing — not single hero images.

## The Andromeda Lens

Meta Andromeda is the retrieval engine that decides which ads from your ad set get considered for which person. It rewards **creative diversification**: a range of ads that differ in meaningful ways so the system can match the right ad to the right viewer. Top advertisers now run 15–50 ads per ad set instead of the old 6-ad cap.

But more isn't better. Two ads with the same concept and slightly different photos will get treated as one signal. They take up two ad slots and contribute one piece of information.

The constraint is two-sided:

- **Too similar** (same concept, same execution, cosmetic tweaks) → Meta treats them as the same ad. The slate is wasted.
- **Too different** (different audiences, different offers, different brand worlds) → Meta will rank them across audiences in ways that fragment the ad set. They probably belong in a different ad set entirely.

The sweet spot: **same theme, meaningfully different execution.** Same audience cohort, same offer, same brand world — different angle, format, persona, or visual treatment.

---

## The Weak / Strong Diversification Test

Before generating, run the slate through this test. Anything that fails goes back to the drawing board.

### ❌ Weak diversification (will not survive Andromeda)
- Same concept, different background color
- Same concept, different model wearing the same outfit
- Same hero shot, different CTA button
- Same headline reworded
- Same demo shot from a slightly different angle
- Same image with different overlay text positions
- AI variations of the same generation seed

### ✅ Strong diversification (real signal for Andromeda)
- Pain-point hook + product demo + social proof testimonial (same offer)
- Lifestyle / context shot + clinical / spec-sheet shot + UGC selfie (same product)
- 9:16 video + 4:5 static + 1:1 carousel (same concept, different formats)
- Parent persona + festival-goer persona + sleeper persona (same product, different audience angles)
- Bold typographic poster + photographic hero + animated explainer (same idea, different visual languages)

Rule of thumb: **if you can imagine two completely different people responding to two ads in your slate, the slate is diversifying. If the same person would shrug at the difference, it isn't.**

---

## The Diversification Axes

A slate gets meaningful difference by varying along these axes. Pull on at least 2–3 per slate. Don't try to vary all of them — that often pushes the slate across the "different ad set" line.

### 1. Concept / Angle
The story the ad tells. Same product, different reason-to-buy.
- **Pain point** → name the discomfort the product resolves
- **Solution / demo** → show the product working
- **Social proof / testimonial** → real person says it works
- **Lifestyle / aspiration** → who you become with it
- **Curiosity hook** → unexpected framing that makes people stop
- **Comparison** → vs. the alternative
- **Contrarian / objection-handler** → addresses the "but what about…" head-on
- **Educational / category-defining** → teach something the audience didn't know

### 2. Format
- Static image
- Short video (≤15s)
- Long video (30–60s)
- Carousel (3–10 cards, narrative or product range)
- Animated still / cinemagraph
- Stop-motion / quick-cut

### 3. Aspect Ratio (Placement Fit)
- **9:16** — Reels, Stories, TikTok-shaped feed
- **4:5** — Facebook / Instagram feed primary
- **1:1** — feed-safe everywhere, also strong for carousels

A single concept rendered across all three ratios already counts as diversification, because each placement-fit feels native to a different surface.

### 4. Persona / Audience Angle
Who the ad is implicitly addressing. Same product, different "you."
- For Loop: parents of small kids, neurodivergent adults, festival-goers, side-sleepers, focus-workers, musicians, frequent flyers
- The persona shifts copy hooks, model casting, and setting — that's three coherent variables moving together

### 5. Visual Treatment
- Documentary / candid photography
- Studio / clinical product
- Bold typographic / poster-led
- Illustrated / animated
- UGC / selfie-shot
- Editorial / lifestyle magazine
- Color-blocked / brand-led
- High-contrast / low-fi

### 6. Copy Style / Hook Pattern
- Question hook ("Ever wondered why…")
- Statistic hook ("3 in 4 people who…")
- Confession / first-person ("I used to…")
- Direct command ("Stop buying earplugs that…")
- Contrarian / negation ("The wrong way to…")
- List / numbered ("5 reasons why…")

### 7. Model / Generator Diversity (often overlooked)
Two semantic generators (e.g. GPT Image 2 + Nano Banana Pro) given the same brief will produce genuinely different aesthetic interpretations. Mixing generators across a slate is itself a diversification lever — it prevents the slate from inheriting one model's visual fingerprint.

---

## The Slate Pipeline

A repeatable workflow from one concept to a diversified slate of prompts.

### Step 1 — Lock the Theme
Write the slate header before any prompt. The theme is what holds the ad set together. If the theme changes mid-slate, those ads belong in a different ad set.

```
SLATE HEADER
Product: [exact product / SKU]
Offer: [the actual proposition — e.g. -20% launch, free shipping, new colorway]
Audience cohort: [the broad cohort this ad set targets]
Theme / through-line: [one sentence that every ad in the slate honors]
Brand non-negotiables: [logo placement, palette boundaries, voice, claims to avoid]
```

### Step 2 — Pick the Axes
Choose which 2–3 axes you'll vary across the slate. Document the choice in the header. Common, useful combinations:

- **Concept × Format** — three angles each rendered as a static + a short video
- **Persona × Visual treatment** — three personas, each with its own visual register
- **Concept × Aspect ratio** — three angles, each placement-native
- **Concept × Generator** — three angles, mixed across GPT Image and Nano Banana

### Step 3 — Build the Variation Matrix
Lay out the slate as a grid before writing any prompt. Each cell becomes one prompt.

Example matrix (Concept × Format, 3 × 2 = 6 ads):

|  | Static (4:5) | Short video (9:16) |
|---|---|---|
| **Pain point** | A1 | A2 |
| **Demo** | B1 | B2 |
| **Testimonial** | C1 | C2 |

This makes the slate's diversification logic visible at a glance — and makes weak-diversification cells (e.g. two cells that would render almost identically) obvious before you spend tokens on them.

### Step 4 — Spec Each Prompt
For each cell, write a prompt that respects the brand non-negotiables, executes the angle, and matches the format. Use the prompting craft from the main SKILL.md and model-specific references. Keep the model anchors (subject, environment, lighting, etc.) consistent for cells in the same row, and let the format / treatment vary.

### Step 5 — QA the Slate Against the Test
Before generating, run the weak/strong test on the prompt set. For each pair of prompts, ask: "Would the same person respond identically to these?" If yes, one of them is doing no diversification work. Replace it with a prompt that pulls a different lever.

Equally: "Would these two ads make sense in the same ad set?" If they feel like they belong to two different brands or two different campaigns, one of them needs to come back inside the theme.

### Step 6 — Generate, Iterate, Cull
- Generate at medium quality first across the whole slate
- Cull obvious failures and weak-diversification pairs
- Re-spec cells that didn't land — usually by sharpening the angle, not by re-rolling
- Render the survivors at final quality
- Ship

### Step 7 — Read the Slate, Not the Ad
Andromeda doesn't pick "the winner." It distributes. So when results come in, judge the **ad set's aggregate performance** against expectations, then look for which axes carried weight (which concepts won, which formats won, which personas won) — not which single ad was the hero. That insight feeds the next slate.

---

## Slate Output Format

When delivering a diversified slate to the user, label each prompt by its axis position so the diversification logic is legible:

```
SLATE: [Theme name]
Theme: [one-sentence through-line]
Axes varied: [e.g. Concept × Format]

---

**A1 — Pain point / Static 4:5:**

[prompt in code box]

**A2 — Pain point / Short video 9:16:**

[prompt in code box]

**B1 — Demo / Static 4:5:**

[prompt in code box]

[etc.]

---

Slate notes:
- [Why these specific axes were chosen for this brief]
- [What weak-diversification traps were avoided]
- [Suggested generation order — usually concepts first, then formats]
```

This format makes the slate audit-able: the user (or anyone reviewing) can see at a glance whether the slate is genuinely diversified or just visually varied.

---

## Common Failure Modes

- **Cosmetic-variation trap.** Generating 10 prompts that are the same concept with rotated props. The visual variance feels like work; the diversification value is zero. Fix: every prompt has to move on at least one axis the matrix tracks.

- **Theme-drift trap.** The slate starts on "earplugs for parents of toddlers" and ends on "earplugs for festival-goers." Two ad sets, not one. Fix: lock the theme in the header and check every prompt against it.

- **Format-only diversification.** Same concept rendered as static, short video, long video. This is *some* diversification (format axis is real), but if it's the only axis moving, the slate is thin. Combine with a second axis.

- **Generator monoculture.** A slate generated entirely by one model inherits that model's aesthetic biases. Even if the concepts vary, the visual language is uniform. Fix: mix semantic generators (GPT Image + Nano Banana) across the slate, especially on the visual-treatment axis.

- **Brand-incoherence trap.** Pushing diversification so hard that the ads stop feeling like the same brand. The audience starts ignoring them as scattered. Fix: brand non-negotiables in the header; visual register can stretch but not break.

- **Over-quantification.** Going to 50 ads because "Andromeda likes scale." Quantity without diversity is just expensive monoculture. Better to ship 8 strongly diversified ads than 30 cosmetic variations.

---

## Quick-Start Templates

### Slate of 6 (entry-level diversified)
- 3 concepts (pain / demo / testimonial)
- × 2 formats (static 4:5 + short video 9:16)

### Slate of 9 (mid-budget)
- 3 concepts × 3 formats (static / short video / carousel)

### Slate of 12 (broad-budget, persona-aware)
- 3 personas × 2 concepts × 2 formats

### Slate of 15+ (full Andromeda mode)
- 3 personas × 3 concepts × 2 formats, plus a creative wildcard cluster (1–3 generator-mixed prompts that pull on visual-treatment / copy-style axes)

Pick the template that matches budget and ad ops bandwidth. The goal is the smallest slate that pulls on enough axes to give Andromeda real signal — not the largest slate the budget tolerates.
