# 15 — Pattern Catalog (multi-page + preview GIFs)

How the `marsin_engine/patterns/` catalog is structured, generated, and
maintained. The catalog is the at-a-glance status board for every top-level show
pattern: a **test_bench preview GIF**, identity, brightness/audio metrics,
cross-model coverage, and remaining issues.

## Layout (multi-page, in `marsin_engine/patterns/`)

| Path | What |
|---|---|
| `catalog.md` | **Index page** — intro, gate thresholds, legend, summary, and a link to each group page. |
| `catalog/<NN-NN>.md` | **Group pages**, one per **5 patterns** (in sequence: `00-04`, `05-09`, … `50-54`, `57-58`). Each shows every pattern's preview GIF + metrics + status, with **Index / Prev / Next** nav at top and bottom. |
| `catalog_data.json` | **Source of truth** — one ordered entry per pattern (curated). |
| `gifs/NN.gif` | The per-pattern **test_bench preview GIF** (gitignored? NO — committed, see below). |

Pattern numbering skips 55/56 (the sequence is `00–54, 57, 58`); the generator
chunks the *ordered* list, so group filenames follow the actual first/last
number in each group of 5.

## Source of truth — `catalog_data.json`

An ordered JSON array; one object per pattern:

```json
{ "num": "30", "name": "bass_comet", "identity": "Comet sweep + trail",
  "peak": "242", "corr": "motion", "titanic": "80",
  "status": "🟢 bass→MOTION primary …", "batch": "B" }
```

- `peak` / `corr` are `null` for batch **A** (00–25, the tuned core — all pass, so
  per-pattern numbers aren't tabulated); strings for batch **B** (preserve values
  like `motion`, `−0.05`, `1.00`).
- `titanic` = pixels lit / 970. `status` carries the legend emoji + notes.
- `batch`: `A` = updated/high-def tuned core (00–25); `B` = HD batch (26–58),
  several still need the ground-rule pass.

**To maintain the catalog: edit `catalog_data.json`, then regenerate.** Do not
hand-edit `catalog.md` or the group pages — they are generated and will be
overwritten.

## Generators (both `marsin_engine/tools/`, Node built-ins, offline)

### `gen_catalog.mjs` — the pages
Reads `catalog_data.json`, chunks into groups of 5, writes `catalog.md` (index) +
`catalog/<NN-NN>.md` (group pages with `<img src="../gifs/NN.gif" width="384">`
and Index/Prev/Next nav). The intro / legend / summary prose lives in this
script (curated). Run from `marsin_engine/`:

```bash
node tools/gen_catalog.mjs
```

### `gen_pattern_gifs.mjs` — the preview GIFs
Renders each pattern's **test_bench** preview as a small animated GIF that
**mirrors the gallery's test_bench strip widget** (`tools/make_vis_clip.mjs`
layout): a horizontal cell **row** for an x-axis section (PARS sId 1, BARS sId 3)
and one **column per fixture** of square cells for a y-axis section (VINTAGE
sId 2), each section stacked and **labelled** (`PARS` / `VINTAGE` / `BARS`).

Pipeline (all offline, no deps): pattern → `pattern_audio_harness.mjs`
(sound-reactive clip on test_bench) → capture JSON (`meta` sId/nx/ny + per-pixel
RGB `frames`) → section layout (derived from `meta`, never invented) → an
**inlined pure-JS GIF89a encoder** (per-frame local colour table + LZW; no
ImageMagick/canvas/deps) → `patterns/gifs/NN.gif`.

```bash
node tools/gen_pattern_gifs.mjs                 # all patterns
node tools/gen_pattern_gifs.mjs --pattern 00,13,25
node tools/gen_pattern_gifs.mjs --seconds 10 --fps 10    # length/frame count (default ~100 frames / 10s)
node tools/gen_pattern_gifs.mjs --variation static       # no-audio baseline instead of sound-reactive
```

GIFs are ~300–350 KB each (≈ 20 MB for the full set) at 100 frames; drop
`--fps`/`--seconds` to trim. They are **committed** (so the catalog renders on
GitHub without a build step).

### Validating a GIF
The repo box has no ImageMagick/PIL and the Read tool won't render animated
GIFs. Validate decode-correctness with Chromium (a spec-correct decoder):
navigate Playwright to `file://…/NN.gif` and check `img.naturalWidth>0`. To view
it upscaled, embed it as a `data:image/gif;base64,…` (a `setContent` page can't
load `file://` images headless) and screenshot.

## Regenerate-everything recipe

```bash
cd marsin_engine
node tools/gen_pattern_gifs.mjs --seconds 10 --fps 10   # 1) previews -> patterns/gifs/
node tools/gen_catalog.mjs                              # 2) index + group pages
git add patterns/catalog.md patterns/catalog patterns/catalog_data.json patterns/gifs tools/gen_catalog.mjs tools/gen_pattern_gifs.mjs
```

## Conventions
- Patterns 00–25 are the **updated, high-def** tuned core; 26–58 are the HD batch
  worklist (status flags per pattern). Keep `batch`/`status` honest as patterns
  are tuned — flip a worklist item to 🟢 in `catalog_data.json` and regenerate.
- Cross-model ④/⑤ items and the `23` dark-space decision are tracked in Notion,
  not duplicated as catalog tasks.
