# Adding a Baby pattern

The Baby show is two playlists now (docs/73 — the Baby Reveal unification):
an outcome-blind **tease**, and one colour-blind **reveal** answer set that
the show paints pink or blue at the button press. There is no boy/girl twin
family any more — `patterns/baby/` is retired. Everything about the set is
*derived* — the suites read what is on disk and cross-check it against the
playlists — so adding a look is a data job, not a test-editing job. Follow the
five steps and nothing else needs to change.

**Two directories, because they are two different jobs:**

| directory | family | filename | numbering |
|---|---|---|---|
| `patterns/baby_tease/` | tease | `<NN>_<concept>.js` | **01-N in PLAYLIST ORDER** — renumber freely when the arc changes |
| `patterns/baby_reveal/` | reveal | `<NN>_<concept>.js` | **01-N in PLAYLIST ORDER**, same rule as the tease — renumber freely when the arc changes |

Both directories use the **same numbering rule** now: `NN` is the playlist
order, not a block allocation. That is a deliberate change from the old
`patterns/baby/` layout, where boy/girl answer numbers grew in blocks and were
never renumbered — that rule existed to keep a boy pattern and its girl twin
paired by concept across two files. There are no twins any more, so there is
nothing to keep paired, and the reveal set gets the tease's simpler contract:
the file order IS the show order.

`baby_tease` and `baby_reveal` are top-level SIBLINGS, not `baby/tease/` or
`baby/reveal/`, because a qualified pattern id carries exactly one directory
segment everywhere in the engine (`api_server.js` `VALID_PATTERN_NAME`,
`playlist_manager.js` `VALID_PATTERN`) and the manifest generator descends
exactly one level for the same reason.

Each playlist is a curated 10-15-look atlas of long-distance-distinct
mathematical fields. Add a look only when its spatial and fixture-local grammar
is measurably unlike every existing cue; remove a weak look instead of keeping
the set large for its own sake.

---

## 1. Name the file

```
patterns/baby_tease/<NN>_<concept>.js      the tease
patterns/baby_reveal/<NN>_<concept>.js     the answer
```

**The directory and the filename are the contract.** Together they file the
pattern into a family — there is no range table anywhere to update. Rules:

- `NN` is at least two digits and **unique inside its own directory** (the two
  directories number independently, so `baby_tease/07_…` and
  `baby_reveal/07_…` may coexist).
- **Numbers ARE the playlist order, in BOTH directories.** Reordering either
  arc means renumbering the files, both scene copies of that playlist's
  `.yaml`, `pattern_goals.json` and the gallery, together, in one landing.
- `concept` is `lower_snake_case`.
- A reveal pattern needs no twin — one file answers both pink and blue.

## 2. Write the pattern

Study a neighbour for engine idiom, then author a new geometry rather than a
phase-shifted copy. The hard contracts, all enforced, and now SPLIT by
directory because the two families have opposite palette rules:

| Rule | Applies to | Why |
|---|---|---|
| **RGB only — W = A = U = 0** | both | The families are RGB mixes. Lighting the white/amber/UV emitters desaturates pink and blue toward white **on the rig only** — the sim host-synths W and hides it. |
| **`baby_tease` must NEVER export `colorPalette1` / `colorPalette2`** | tease | Declaring one hands the tease's colour to the palette autopilot, which would let it answer the question early. The guarantee is "these patterns declare neither". |
| **`baby_reveal` MUST export `colorPalette1` — and must NOT export `colorPalette2`** | reveal | **This rule is the INVERSE of the tease's, and it is new.** One slot decides everything: the reveal reads the global primary and derives its own dark tone from it, so `colorPalette2` is never read and exporting it would advertise a dependency the family does not have. See "The palette-carrier contract" below — this is what makes one pattern set answer both outcomes *and* stay visible on the deck. |
| **Use the exact family RGB mixes** (tease only, copy verbatim from any sibling) | tease | The classifier is narrow on purpose: pink means *red leads, green is the floor*, blue means *blue leads, green sits between*. A hand-tuned mix drifts out of the family and fails as a "forbidden third hue". `baby_reveal` has no hard-coded mix to copy — its colour comes from the palette, not from a constant. |
| **Tease: BOTH families in every frame** | tease | `baby_tease` must not answer the question. Use two coherent mathematical fields separated by intentional black negative space; never assign family ownership from pixel address. Stay near 50/50 most of the loop, with only brief territorial feints. |
| **Black is designed, not accidental** | both | Crisp seams, rims, shutters, banks, membranes, and pauses may be exact black. They must reveal the composition, never become random dropout. |
| **Align world fields to the smokestacks** | both | Raw X/Z is rotated into a ship-local frame derived from all 12 left and all 12 right smokestack pixels. This removes the model's roughly 40-degree world rotation before any continent, river, cell, or compression geometry is evaluated. |
| **Use intentional negative space** | both | At saved defaults, black occupies a visible but bounded portion of the rig while the pattern retains bright readable structure. Seams, pores, veins, shelves, or ridges must follow the concept and never become random pixel noise. |
| **Author Vintage and TE signs explicitly** | both | Each six-head Vintage fixture and each TE sign must use its complete fixture-local surface for pattern-specific, balanced, animated 2D art with crisp black separation. (`baby_tease` additionally needs both colour families locally per fixture, with at least one black separator head — `baby_reveal` is single-colour per arm so this reduces to "balanced and animated".) |
| **Keep the composition unmistakable** | both | Black is allowed only where the composition calls for it; the pattern's structure remains plainly visible in every representative frame. |

Two measured floors, both swept over 5 s rather than sampled at two instants:

- **Animated**: peak per-pixel delta ≥ 40 **and** mean-frame delta ≥ 1.0.
- **Distinct from every sibling in its family**: mean delta > 1.5 at t = 5 s.
  This is deliberately low — it catches a copy-paste duplicate without
  demanding that every composition be maximally different. Give a new look its
  own *topology and motion*, not just its own parameters.

Sliders are declared in MFT knob order (`.agent/memory/pattern-param-order.md`);
whatever you export becomes the playlist entry's `defaults` block in step 4.

### The palette-carrier contract, and the derived dark tone

`baby_reveal` patterns do not know pink from blue. They render **the global
colour palette**, through one ParamCenter `hsv` slot every reveal pattern
declares and reads:

- `colorPalette1` — the primary. A full-strength pixel is this colour.
- the dark tone — **derived here, not received.** The authority block converts
  the primary to an RGB triple and multiplies it by `DARK_K = 0.28`. Scaling
  RGB by a scalar is exactly "same hue, same saturation, value × 0.28", so the
  second tone is the primary very darkened *by construction* — there is no
  second authored value that has to agree with it.

`colorPalette2` is **not read, and must not be exported.** A reveal pattern
that declared it would advertise a dependency it does not have; a
`colorPalette2` write arriving from anywhere is simply ignored by this family.
`DARK_K` therefore lives in exactly one place — the authority block,
byte-identical across all ten sources — and a retune of the dark tone is a
ten-file edit of one constant, not a pattern/show agreement that can drift.

**These looks are deck-visible.** Load any `baby_reveal` pattern on the deck
under any ordinary global palette and it animates in that colour, dark tone and
all. There is no arming step, no handshake, and nothing that has to line up
before the composition appears. That is the point of the contract as it now
stands: the operator ruled out the earlier design precisely because it rendered
black on the deck (operator ruling — `docs/73` "Contract v2" / §2.4-v2; the
superseded two-slot handshake is still on the record in that file's §2.4, which
is worth reading before anyone proposes reintroducing it). At reveal time the
show simply writes `colorPalette1`, and
the same patterns that the operator has been auditioning all along come up in
the answer's colour.

**The one refusal that remains is an INVALID palette.** If any of `h`, `s`, `v`
falls outside `[0, 1]`, every pixel renders black — the family never
substitutes a colour of its own. What it cannot do is detect an *absent*
palette, and that is a property of the VM, measured against the real compiler
rather than assumed: the VM installs its own `hsvPicker` default (`h 0, s 1,
v 1` — the same triple the engine registry carries for `colorPalette1`) and
calls the exported setter at program init, whatever the declared `export var
cp1H…` values say. "Never pushed" and "pushed the engine default" are one
indistinguishable state, so a pattern nobody pushed a palette to renders red,
not black. Every live load path pushes the real palette first anyway
(`finalizeCpcValues` in `marsin_engine/lib/api_server.js`).

To force a specific colour for a deliberate preview — checking the hero look in
the exact show pink, say — write the one slot directly:

```json
POST /param-center
{ "colorPalette1": { "h": 0.943869, "s": 0.965, "v": 1.0 } }
```

Baby blue is `{ "h": 0.594795, "s": 0.967, "v": 1.0 }`. These are the hues the
`girl` and `boy` choices in
`simulation/scenes/{titanic,test_bench}/special_events/baby_reveal.yaml` write.
**The old two-slot arming step is obsolete** — writing `colorPalette2` at
`v: 0.28` alongside does nothing now, and pinning `colorTransitionMs: 0` is no
longer needed either: a mid-ramp hue is a valid palette and renders as one
instead of falling out of a family match, so a slewed write just fades the look
into its colour. Pin the transition only when you want the colour to snap.

**Offline (the audio harness).** `marsin_engine/tools/pattern_audio_harness.mjs`
seeds `colorPalette1` from the pattern's own declared `export var cp1H…`
defaults — `h 0, s 1, v 1`, which is **red**. An offline render with no `--set`
therefore comes out red, not black, and a `GATE_FAIL DARK` on a `baby_reveal`
pattern is now a real finding about the pattern rather than a missing palette
injection. Drive a chosen colour with one `--set` carrying an HSV triple
(colons, because `--set` is already comma-separated):

```
node tools/pattern_audio_harness.mjs --pattern <path> --model titanic \
  --seconds 6 --out-fps 4 --synth silence --out <out.json> \
  --set "colorPalette1=0.943869:0.965:1.0"
```

`0.594795:0.967:1.0` for blue.

## 3. Register it in the manifest

Qualified `baby_reveal/…` and `baby_tease/…` ids only reach the operator's
pattern picker if they are in `marsin_engine/patterns/manifest.json`.

Both are already registered directories in
`simulation/server/pattern_manifest.cjs`, so **there is no code to change** —
the manifest is regenerated from disk. Either start the sim (`cd simulation &&
npm start` rewrites it at boot) or regenerate it directly:

```bash
node -e "const m=require('./simulation/server/pattern_manifest.cjs');\
require('fs').writeFileSync('marsin_engine/patterns/manifest.json',\
JSON.stringify(m.listPatterns('marsin_engine/patterns'),null,2)+'\n')"
```

> This is the step that silently ate a whole pattern family once (report
> `_222` §2): the old generator was top-level-only, so every qualified id was
> deleted from the manifest at the next `npm start`. It is now an explicit
> registry that **throws** on an unclassified subdirectory. If you ever add a
> *new* family directory, add it to `MANIFEST_PATTERN_DIRS`.

## 4. Add it to the playlist — **both scenes**

```
simulation/scenes/titanic/playlists/<baby_tease|baby_reveal>.yaml
simulation/scenes/test_bench/playlists/…      ← must be BYTE-IDENTICAL
```

Every family member must appear in its playlist. The order is a curated show
arc rather than a filename sort — and for `baby_reveal` the order is now the
file numbering too (step 1). Each entry's `defaults` must name **exactly**
the sliders the pattern actually exports. Pattern sources retain
`localSpeed: 0.30` as the authoring reference, while the Reveal playlist loads
every entry at the deliberate show-speed value `sliderLocalSpeed: 0.468`.
New Reveal entries must use that same playlist value unless the whole family is
retuned together. A default naming a slider that does not exist lands on
nothing and looks like a retune. These facts are asserted per entry.

The playlist is also what the SPECIAL EVENT arms, and the runner refuses to ARM
if a playlist is missing or has no loadable entry — so an unregistered pattern
is a dead show, not a cosmetic diff.

## 5. Regenerate the gallery

```bash
node marsin_engine/tools/playlist_gallery/generate.mjs --playlist baby_tease
node marsin_engine/tools/playlist_gallery/generate.mjs --playlist baby_reveal
node marsin_engine/tools/playlist_gallery/generate.mjs --index-only
```

Qualified ids need no special handling — the generator already walks
subdirectories and sanitises the `/` for media filenames only
(`001_baby_tease__01_bullseye_tide.gif`). Add a one-line intent for the new id
to `marsin_engine/tools/playlist_gallery/pattern_goals.json`. A `baby_reveal`
render needs nothing armed: with no palette flag the generator renders every
entry at the pattern's declared defaults, which for this family is red (the
harness note in step 2). Its `--palette <id>` flag does **not** currently reach
this family — it requires a pattern to export both `colorPalette1` and
`colorPalette2` and throws on one that declares only the first, and the palettes
in `marsin_engine/config.yaml` are two-hue duets rather than a primary. Putting
the gallery into a chosen reveal colour is a follow-up on the generator, not on
the patterns.

---

## Run the gates

```bash
cd marsin_engine
node --test tests/patterns/baby_color_contract.test.js      # the whole contract
node --test tests/patterns/playlist_gallery_tool.test.mjs   # gallery renders it
cd ../simulation && node --test tests/pattern_manifest.test.js
```

`baby_color_contract.test.js` is the one that matters. It compiles every Baby
pattern on **both** rigs (`titanic` and `test_bench`), so a pattern that leans
on `FIX_*` / `sectionId` branching fails there — the family must be portable.

Every count in it is derived, so a green run after steps 1–5 means the set is
consistent end to end. The failures are written to name the file and the
reason. As of the Baby Reveal unification (docs/73), the file carries a TODO
naming the reveal-specific composition gates still to land — single-family
purity per live colour, two-tone separation between the primary and its
derived dark tone, anti-bilateral-split, and cross-pattern distinctness beyond
the generic animation sweep — once `patterns/baby_reveal/` is complete enough
to measure them against.

## What is deliberately NOT enforced

- **An exact keeper count.** The artistic operating range is 10-15 per
  playlist; curation, not accumulation, chooses the number inside that range.
- **Tease pattern rotation timing.** That is show data, not pattern data — the
  `autopilot:` block on the tease stage of
  `simulation/scenes/titanic/special_events/baby_reveal.yaml`, retunable live
  from the CaptainPad SPECIAL EVENTS tab while the show runs.

## What used to be true here and no longer is

- ~~`patterns/baby/` holds the boy/girl answer twins.~~ Retired. The answer
  family is now the single colour-blind `patterns/baby_reveal/`.
- ~~Never export `colorPalette1`/`colorPalette2`.~~ Still true for
  `baby_tease`. **Half-inverted** for `baby_reveal`: it must export
  `colorPalette1`, and must still never export `colorPalette2`.
- ~~`baby_reveal` needs a two-slot handshake — same hue on both slots, slot 2
  at `DARK_K` — and renders black without it, so a deck preview is black.~~
  Ruled out by the operator. One slot carries the colour, the dark tone is
  derived from it, and the deck shows these looks animating in whatever
  palette is live. Only an *invalid* palette renders black.
- ~~A boy pattern and its girl twin share the same `concept`, differing only in
  six `COLOR_*` constants.~~ There are no twins. One `baby_reveal` pattern
  answers both outcomes through the palette, not through a paired file.
