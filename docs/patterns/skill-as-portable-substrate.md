# Skill As Portable Substrate

## Intent

Encode a way of working into a Claude Skill once, then run that same Skill behind any interface the team needs: a chat box for one user, a product button for the team, a server-side workflow agent for batch jobs. The interface changes; the encoded judgment does not.

## Seen in

- `loop-vesper` (the Studio prompt enhancement Skill is the same Skill the team uses in Claude.ai; in the product it sits behind the enhance button and is parameterized by selected model and reference image presence).
- `babylon` (Loop Localization Skill carries brand voice, banned terms, and exception logic for atypical caption styles; the same Skill drives the Claude.ai workflow for translators and the in-product translation pipeline).
- `mimir` (briefing and synthesis Skills sit behind the briefing composer; the same Skills are usable directly in Claude.ai for ad hoc strategist work).
- Cousin pattern: per-team encoding Skills that emerge from workshops and live in the team's Claude.ai workspace before being wired into a product.

## Transfer

The realization happened during Vesper. The prompt enhancement logic had been written and refined as a Claude Skill so the team could use it inside Claude.ai. Once Vesper existed, wiring that same Skill behind a product button was a small step that made the encoded judgment available without asking the team to leave the platform. The principle then generalized: Babylon's localization Skill, Mimir's briefing Skills, and team-specific Skills produced from workshops all follow the same shape.

The Anthropic article on degrees of freedom (used heavily in Mimir) sharpened how this is encoded. A Skill is not a single instruction. It is a contract that says where the model must be locked (data, KPIs), where it can be guided (brand voice, exception handling), and where it is asked to interpret freely (creative direction). Encoding that calibration is what makes the same substrate usable across both rigorous and creative surfaces.

## Best current expression

`loop-vesper` for the original "Skill behind a product button" pattern. `babylon` for the most complete brand-voice and exception-handling expression. `mimir` for the most explicit use of degrees of freedom across steps in the same Skill.

## Do not copy

- Loop-specific brand voice content, banned terms, or product catalogue references.
- Loop-specific catalogue lookups baked into the Skill itself rather than passed in as context.
- Skills that hard-code per-language exception lists. Encode the way of thinking; pass the language as parameter.
- The assumption that a Skill's chat-box behaviour translates 1:1 to a product button. Parameter contracts (selected model, reference image presence, current project) are usually needed.

## Reusable principle

A Skill is the smallest portable unit of encoded judgment. If the same logic should run in chat, behind a button, in a server agent, or in a future interface that has not been built yet, it belongs in a Skill rather than in any one of those interfaces. The interface is the surface. The Skill is the substrate.

## Encoding target

- Thoughtform Strategy and `thoughtform-repos` Skill (already gestures at this principle in the encoding section).
- ADR for any product that wires a Skill behind a UI affordance.
- Pattern note in any new repo where a workflow Skill is shipping ahead of the UI that will eventually consume it.

## Status

`candidate-canonical`. Promote to `canonical` once a third unrelated team or repo (outside Vesper, Babylon, Mimir) ships the same shape.

## Evidence

- `loop-vesper` prompt enhancement layer behind the enhance button.
- `babylon` `src/skills/loop-localization/` powering both translation runs in product and the equivalent workflow in Claude.ai.
- `mimir` skills directory used in the briefing composer and equivalently usable in Claude.ai.
