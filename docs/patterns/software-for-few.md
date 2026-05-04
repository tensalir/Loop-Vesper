# Software For Few

## Intent

Build small, precise tools for a specific team whose problem has clear business impact, when off-the-shelf tools do not fit and an external build is not justifiable for so few users. Treat the team's specificity as the feature, not the limitation.

## Seen in

- `loop-vesper` (Studio team prompt and generation workspace).
- `babylon` (localization team verification, proofing, naming, analytics).
- `heimdall` (creative ops bridge across Monday, Figma, Frontify).
- `mimir` (creative strategy newsroom and briefing composer).
- `ledger` (Thoughtform internal accountancy renamer).
- `repo-intelligence` (the Thoughtform MCP and connector).

## Transfer

The pattern repeated across the Loop tools without being planned. Each repo started from a specific team's friction (Studio prompt switching, localization verification gate, Monday-to-Figma copy-paste, paid-social briefing fragmentation), used AI-assisted building to fill a gap that no SaaS roadmap would prioritize, and stayed deliberately narrow in scope. The framing was named explicitly during Loop's AI adoption proposal, by which point it was already operating as the default posture.

## Best current expression

`loop-vesper` is the cleanest first proof at Loop. `babylon` is the most developed example of the pattern at scale, including external sharing and multi-surface consolidation. The principle is canonical; which repo expresses it best depends on the workflow being analyzed.

## Do not copy

- The dashboard or interface as evidence that the engine is correct. The reusable asset is the substrate (data model, encoded judgment, integrations), not the screens.
- Loop-specific integrations (Monday board IDs, Frontify project paths, brand voice rules) when transferring the principle to a new context.
- The assumption that a team-of-ten tool will "naturally grow" into a platform. The shape and trade-offs change at scale; planning for both undermines both.

## Reusable principle

When a specific team has a measurable problem, off-the-shelf tools do not fit, and an external agency build is not justifiable for the number of users, AI-assisted building lives in that delta. Sized to the team, owned by an embedded operator, and treated as a working platform rather than a prototype, the result is a tool the team adopts and an engine the constellation can inherit.

## Encoding target

- Thoughtform Strategy reference (already canonical at the constellation level).
- Per-repo README "Status and boundaries" section, where the team-shaped scope should be visible.
- Loop policy work in progress around prototyping, software-for-few, and production handoff paths.

## Status

`canonical` as a principle across the Loop constellation. `candidate-canonical` per repo until that repo's specific implementation is reviewed for reusability.

## Evidence

- `loop-vesper` Studio workflow replacement, single-operator build, daily team adoption.
- `babylon` localization team scope, AI-assisted verification trick, multi-surface consolidation.
- `heimdall` workflow bridge between SaaS tools the team is not replacing.
- `mimir` creative strategy newsroom built for Loop's specific data sources.
