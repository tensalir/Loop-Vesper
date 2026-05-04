# Midjourney — Model Reference

Midjourney is pure descriptive prompting — dense, vivid, aesthetic-forward. It pattern-matches against artistic training data rather than understanding semantics.

**IMPORTANT:** Do NOT add parameters (--ar, --v, --sref, --style raw, etc.) unless the user explicitly requests them. Output descriptive content only.

## Prompt Approach

Stack vivid descriptions, artist references, mood keywords:

```
a majestic robotic seraph carved from white silicon and quartz floating in an ancient red stone canyon temple in the style of Greg Rutkowski, feminine humanoid torso with elegant mechanical joints, slender arms, two large white feathered wings spread wide, head a smooth featureless white ovoid with no face, below the waist the body dissolves into hundreds of trailing fiber optic cables pulsing with faint light, hands cramped and contorted in trance state fingers curling and twisting as if receiving divine signal, halo a dark metal ring floating above the head inscribed with glowing Enochian angelic script, hovering between ruined columns, warm painterly light, retrofuturistic sacred
```

---

## Multi-Prompts (Concept Separation)

Use `::` to separate concepts so Midjourney treats them as distinct elements to blend:
- `space ship` → sci-fi spaceships
- `space:: ship` → space + ship as separate concepts (could be a sailing ship in space)

Add weights after `::` to emphasize elements:
- `space::2 ship` → "space" is twice as important as "ship"

**Note:** Multi-prompt compatibility varies by model version.

---

## Style References (--sref)

When the user provides sref codes, these lock in specific aesthetics. Key principles:
- Codes can be combined (sequence matters — earlier codes have more influence)
- Weights can be applied with `::` syntax
- `--sref random` discovers new styles (returns a reusable code)

---

## Permutation Prompts

Use curly braces `{}` with comma-separated values to batch-generate variations:

```
a {red, green, blue} bird in the {jungle, desert}
```
→ Generates 6 combinations

Works on any part of the prompt including parameters.

---

## SREF Permutations

When asked to create **sref permutations**, generate all possible orderings:

**Input:** `--sref 3672663161 1425749592 1072662281 3012683857`

**Output format:**
```
--sref {3672663161 1425749592 1072662281 3012683857, 3672663161 1425749592 3012683857 1072662281, 3672663161 1072662281 1425749592 3012683857, ...}
```

Generate all orderings (4 codes = 24 permutations).

---

## Artist/Director Reference Permutations

When asked for **reference permutations**, insert this list:

```
in the style of {Roger Deakins, Greig Fraser, Christopher Nolan, James Cameron, Francis Ford Coppola, Peter Jackson, Chloé Zhao, JJ Abrams, Denis Villeneuve, Zack Snyder, George Lucas, Stanley Kubrick, Steven Spielberg, Wong Kar Wai, Clive Barker, George Romero, Wes Craven, Guillermo del Toro, Tim Burton, Wolfgang Petersen, Hajime Sorayama, Frank Frazetta, Alex Ross, Bill Sienkiewicz, Ralph McQuarrie, Alphonse Mucha, Norman Rockwell, Greg Rutkowski, Boris Vallejo, Moebius, Jodorowsky Dune}
```
