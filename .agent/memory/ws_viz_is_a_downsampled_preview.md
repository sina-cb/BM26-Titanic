---
name: ws-viz-is-a-downsampled-preview
description: The engine's /ws/viz rig buffer is a 100-pixel PREVIEW of the 964-pixel rig, so adjacent pixels are averaged — it cannot be used to test palette purity or anything with fine spatial detail.
type: lesson
created: 2026-08-05
updated: 2026-08-05
---

**The fact (measured 2026-08-05).** A `vis` frame on `/ws/viz` carries a
`vis.rig` base64 buffer of **600 bytes = 100 pixels**, while the titanic model
renders **964**. That is roughly ten rig pixels averaged into each preview
pixel.

**What it breaks.** Any assertion about fine spatial structure. A pattern
painting 3-pixel colour blocks has each preview pixel averaging several
different colours, which produces hues that are in BETWEEN the chosen ones —
so the capture looks like the pattern is interpolating when it is not.
Measured: `66_five_colour_prism`, which paints exactly five fully-saturated
colours and never blends, shows **81 distinct hue buckets** through this bus.

**Two "failures" in one session were this instrument, not the code** — an
"off-palette hue on the ship" check and a "5 distinct colours" check both
failed against the preview while the pattern was provably correct.

**How to apply:**
- Do NOT use `/ws/viz` to test palette purity, block structure, per-fixture
  colour, or anything else needing per-pixel truth.
- Use the **offline harness** for that: its capture is full resolution
  (`frames[i]` is one `[r,g,b]` per real pixel) and it runs the real VM against
  the real model. That is where "exactly five hue clusters, each within 0.2° of
  a chosen colour" was actually proven.
- `/ws/viz` is still fine for coarse questions: is the rig lit at all, is it
  animating, roughly which colours dominate.
- Sim SCREENSHOTS cannot substitute either — the renderer shows flood-lit
  geometry with bloom, so hues cannot be counted from an image. Use renders for
  "does this look right to a human", not for measurement.
