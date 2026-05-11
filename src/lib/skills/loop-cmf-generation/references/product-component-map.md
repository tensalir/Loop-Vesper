# Product & Component Map

Stable component vocabulary per Loop product. Region keys (snake_case) are the contract between the workbook, the clown PNG, and the recolour prompt. Adding a new product means adding an entry here, an entry in `src/lib/cmf/products.ts`, and a matching clown PNG in the library.

## Contents

- Switch 2 / Switch 2 CC
- Engage 2 / Engage 2 CC
- Experience 2 / Experience 2 CC
- Quiet 2 / Quiet 2 CC
- Dream / Dream CC
- Cocoon
- Link / Link Pouch
- Aphrodite / Aphrodite CC
- Eclipse
- Generic carry case
- Clown render constraints

## Switch 2 (`switch2`)

| Region | Workbook label | Default material | Default finish |
|--------|----------------|------------------|----------------|
| `pom_ring` | POM RING | POM | Matte |
| `cosmetic_cap` | COSMETIC CAP | ABS | NCVM Satin |
| `nozzle_piece` | NOZZLE PIECE + RETENTION RING | ABS | VDI 21 Matte |
| `eartip` | EARTIP (hidden flange) | Silicone | Milky see-through 30% |
| `artwork` | ARTWORK | — | Pad printing |

## Switch 2 CC (`case-switch2`)

| Region | Workbook label | Default material | Default finish |
|--------|----------------|------------------|----------------|
| `shell_front` | Shell - Front | ABS | VDI 24 |
| `shell_back` | Shell - Back | ABS | VDI 24 |
| `insert` | Insert | Silicone | VDI 24 |
| `cord` | Cord | TPE | Matte |
| `artwork` | ARTWORK | — | — |

## Engage 2 (`engage2`)

| Region | Workbook label | Material |
|--------|----------------|----------|
| `body_left` | Body - Left | ABS |
| `body_right` | Body - Right | ABS |
| `eartip_left` | Ear tips - Left | Silicone |
| `eartip_right` | Ear tips - Right | Silicone |

Engage 2 CC mirrors Switch 2 CC's region set (`shell_front`, `shell_back`, `insert`, `cord`).

## Experience 2 (`experience2`)

| Region | Workbook label | Material | Finish |
|--------|----------------|----------|--------|
| `body_left` | Body - Left | ABS | NCVM high glossy |
| `body_right` | Body - Right | ABS | NCVM high glossy |
| `eartip_left` | Ear tips - Left | Silicone (Shore 50) | Grinded matte |
| `eartip_right` | Ear tips - Right | Silicone (Shore 50) | Grinded matte |

Reference finishing: "Same as Experience chrome silver" is captured in notes — make sure the prompt matches the chrome silver material response.

Experience 2 CC mirrors the generic case region set.

## Quiet 2 (`quiet2`)

| Region | Workbook label | Material |
|--------|----------------|----------|
| `body_left` | Body - Left | Silicone |
| `body_right` | Body - Right | Silicone |
| `tip_left` | Tip - Left (Ear Tip) | Silicone |
| `tip_right` | Tip - Right (Ear Tip) | Silicone |

Quiet 2 CC uses the generic case region set.

## Dream (`dream`)

| Region | Workbook label | Material | Finish |
|--------|----------------|----------|--------|
| `body_outer` | Body - Outer | Silicone (Shore 30) | VDI 18 |
| `body_stem` | Body - Stem | Silicone (Shore 90) | VDI 24 |
| `tip_sleeve` | Tip - Sleeve | Silicone (Shore 50) | Grinded |
| `tip_core` | Tip - Core | PU Foam | (TBD) |

Dream often uses translucency. Always carry `Color pigment %` and `Transmittance %` into notes so the prompt can reflect milky / opaque behaviour.

## Dream CC (`case-dream`)

| Region | Workbook label | Material |
|--------|----------------|----------|
| `shell_front` | CC Shell - Front | PC/ABS |
| `shell_back` | CC Shell - Back | PC/ABS |
| `tray` | Inner tray | TPU |
| `lanyard` | Lanyard | Silicone |

## Cocoon (`cocoon`) — baby earmuffs

| Region | Material |
|--------|----------|
| `ear_cushion` | Fabric (microfiber) |
| `foam` | PU foam |
| `earcup` | ABS (VDI 21 Matte) |
| `front_strap` | Elastic knit fabric |
| `velcro_front` | PA Velcro |
| `pouch` | Polyester velour |

Cocoon includes `L*A*B=` and `Delta E` tolerances — keep those in notes and surface them on the PDF spec table.

## Link (`link`)

| Region | Material |
|--------|----------|
| `connector_stem` | Silicon (Shore 50) |
| `aglet_part_1` | Aluminum AL6063 |
| `aglet_part_2` | (matched to part 1 unless overridden) |
| `cord` | Nylon (Color Fastness Level 4) |
| `pouch` | Silicon (Shore 70) |

## Aphrodite (`aphrodite`)

| Region | Material | Finish |
|--------|----------|--------|
| `a_top_housing` | PC LDS-compatible | High-gloss mirror polish |
| `b_button_cap` | PC/ABS LDS-compatible | VDI 24 |
| `c_bottom_shore` | Silicon 60A | Low-gloss matte (5–10 GU) |
| `d_bottom_housing` | PC/ABS | VDI 24 |
| `e_eartip` | Silicon 60A | VDI 21 |
| `f_ir_window` | (supplier spec) | High-gloss mirror polish |
| `g_pogo_pins` | (supplier copper) | — |

## Aphrodite CC (`case-aphrodite`)

Numbered components 1–11 + battery group 12–14. The skill should treat the numbered prefix (`1.`, `2.`, …) as part of the label but slugify them into stable region keys (`case_lid_housing`, `inner_lid_housing`, `hinge`, `lower_housing`, `cradle_housing`, `button`, `battery_bracket`, `inner_lower_housing`, `battery_wrap`, `pull_tab`, `battery_cosmetic_cover`).

## Eclipse (`eclipse`) — sleep mask

| Region | Material |
|--------|----------|
| `strap_exterior` | 85% PA / 15% EL (130 GSM) |
| `strap_interior` | 85% PA / 15% EL (130 GSM) |
| `o_logo` | Silicone (matte) |
| `wordmark_logo` | Silicone (matte) |
| `eyecup_exterior` | 85% PA / 15% EL (130 GSM) |
| `eyecup_interior` | 85% PA / 15% EL (130 GSM) |
| `anti_slip` | Silicone (matte) |
| `velcro_loop_face` / `velcro_hook_a` / `velcro_hook_b` | (textile library) |

Eclipse uses textile reference codes (`BNY08-2`, `BYN08-02`, `3-7T`, `PA15EL-*`). Render the textile photo next to the spec.

## Generic carry case (`case`)

Fallback when no product-specific case slug applies.

| Region | Material |
|--------|----------|
| `shell` | PC/ABS |
| `lid` | PC/ABS |
| `tray` | TPU |
| `lanyard` | Silicone |

## Clown render constraints

The clown PNG is the geometric and lighting reference for Nano Banana. It must:

- Use up to **four** primary recolour regions painted in solid red, green, blue, yellow.
- Reserve pink only for products with a genuine fifth region (Aphrodite jewel, Switch 2 button accent).
- Bake reflections and material highlights in KeyShot — Nano Banana reads those reflections to infer material response.
- Live in the workspace-shared clown library at `cmf/clowns/{productSlug}/{variantSlug}.png`.
- Use opaque colour blocks; gradient regions confuse the recolour mask.

When a product is added but no clown exists, the import path still produces SKUs, but `runCmfRender` will fail with category `reference` until a clown is uploaded.
