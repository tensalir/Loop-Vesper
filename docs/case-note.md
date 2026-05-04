# Vesper Case Note

The build story behind Vesper. The README answers what it is. This note answers how it came to be and what it proves about the way the work moves at Loop.

## Trigger

Through 2025, Loop ran AI image and video campaigns out of a fragmented stack: prompt writing in Claude or ChatGPT, generation in Krea or VEO 3, iteration through tabs. The ATL video sprint made the friction acute. Around the same time, Claude crossed a threshold late in 2025 that turned "this is hypothetically possible to build" into "I can ship this without an agency." Vesper was the first attempt to use that unlock to replace the workflow with a tool sized for the team.

## Bottleneck

Three problems compounded.

Krea's margin-on-API-calls model meant every campaign was paying for opacity. The pricing was defensible as a business model and unworkable at the volume Loop runs.

Switching between an LLM tab for prompt writing and a separate generation tool broke flow on every iteration. In a production sprint, those tab switches add up to hours, and they cost more than the time itself: they cost the train of thought that produces the better idea.

Specific features the Studio team needed did not exist in any off-the-shelf tool and probably never will, because they only matter for this team. Prompt enhancement linked to the Loop product catalogue. Animate-still in place. PDF image extraction from briefing documents. Each one is small. Together they are the difference between a tool and a workflow.

## Key insight

The unlock was not a better model. It was that one embedded operator could now build a platform that absorbs an entire workflow. Vesper proved that thesis at Loop. Once it was running, the team adopted it. Once it was adopted, it became the place where another encoding move surfaced: the same Claude Skill the team used inside Claude.ai for prompt writing could sit behind Vesper's enhance button. Same intelligence, different interface. That made encoding visible as a strategy rather than a side effect.

## What emerged

A project- and session-scoped generation workspace with infinite scroll, real-time updates, multi-model adapters (Gemini Flash Image, Veo 3.1, Replicate Seedream, Kling), Claude-powered prompt enhancement, animate-still in popup, PDF reference extraction, and a small admin layer.

What it taught downstream is more durable than any single feature. The model adapter shape and the prompt enhancement pipeline became the spine of Sigil's generation suite. The Loop-Vesper design tokens carried into Babylon, Heimdall, and Mimir. Vesper is the first repo that ran the full Loop loop: navigate the broken workflow, encode the recurring move (prompt enhancement, model selection, reference handling), build the thin tool that turns the loop into a daily habit.

## Transfer lineage

- **Informed by:** the broken Krea / ChatGPT / VEO 3 workflow, the Loop product catalogue, and the Studio team's habits during the 2025 AI campaign cycle.
- **Informs:** Sigil (model adapter and prompt enhancement pipeline reused directly), Babylon and Heimdall and Mimir (Loop-Vesper design tokens and Supabase / Prisma / TanStack Query patterns reused), the broader Loop encoding posture (Skills as portable substrate behind a UI button, not just behind a chat box).
- **Knowledge transfer mode:** code reuse for the adapter and enhancement pipeline; pattern reuse for the workspace shape; principle transfer for the "Skill behind UI" idea that later applied to Babylon translation and Mimir briefing.

## Reusable patterns

- [software-for-few](patterns/software-for-few.md) — the framing for every Loop tool that follows.
- [skill-as-portable-substrate](patterns/skill-as-portable-substrate.md) — the same Claude Skill behind chat and behind a product button.

## What not to copy

- The `prism` package name — leftover scaffold; Vesper is the canonical name.
- Provider-specific adapter behaviour that hard-codes Loop's product catalogue references.
- Loop catalogue schema and prompt enhancement copy that encodes Loop brand voice.
- Any FAL.ai code paths that are present but not wired into the active runtime.

## Portfolio interpretation

Vesper proves a way of working: when an embedded operator is given enough room and the model crosses the right threshold, replacing a fragmented SaaS workflow with a tool sized to the team is not heroic, it is achievable. The output is not just faster image generation. It is the first internal platform that gave Loop a working answer to "what does software for a team of ten look like, and what does it teach us to build next?"

## Provenance

Drafted from a May 2026 retrospective and the working notes staged at [thoughtform-repo-intelligence/proposals/loop-vesper](https://github.com/thoughtform-co/thoughtform-repo-intelligence/tree/main/proposals/loop-vesper).
