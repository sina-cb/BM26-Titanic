# Adding a Baby pattern

The Baby show is three playlists: an outcome-blind **tease**, and the **boy** /
**girl** answers. Everything about the set is *derived* — the suites read what
is on disk and cross-check it against the playlists — so adding a look is a
data job, not a test-editing job. Follow the five steps and nothing else needs
to change.

The operator wants the **tease well past 20 looks**, so that is the family that
grows most often.

---

## 1. Name the file

```
<NN>_<family>_<concept>.js        family ∈ tease | boy | girl
```

**The filename is the contract.** It is what files the pattern into a family —
there is no range table anywhere to update. Rules:

- `NN` is at least two digits and **unique** across the whole directory.
- Numbers grow in blocks. Take the next free number; do not renumber anything.
- `concept` is `lower_snake_case`.
- **A boy pattern and its girl twin share the same `concept`.** The twin check
  pairs on the concept, not on the number, so `51_boy_keel_breath` ↔
  `66_girl_keel_breath` is a valid pair no matter how far apart they sit.
- A tease pattern needs no twin.

## 2. Write the pattern

Copy the shape of a neighbour (`01_tease_orbit_question.js` is the roomiest;
`13_tease_wave_collision.js` and `15_tease_velocity_weave.js` are the compact
idiom). The hard contracts, all enforced:

| Rule | Why |
|---|---|
| **RGB only — W = A = U = 0** | The families are RGB mixes. Lighting the white/amber/UV emitters desaturates pink and blue toward white **on the rig only** — the sim host-synths W and hides it. |
| **Never export `colorPalette1` / `colorPalette2`** | Declaring one hands the reveal's colour to the palette autopilot. The guarantee is "these patterns declare neither". |
| **Use the exact family RGB mixes** (copy them verbatim from any sibling) | The classifier is narrow on purpose: pink means *red leads, green is the floor*, blue means *blue leads, green sits between*. A hand-tuned mix drifts out of the family and fails as a "forbidden third hue". |
| **Tease: BOTH families in every frame** | `baby_tease` must not answer the question. The idiom is `var familyBlue = index % 2;` plus a per-family field, which guarantees the split. ≥ 40 lit pixels of each, at every sample time. |
| **Boy: blue ONLY. Girl: pink ONLY.** | One stray pixel of the other family on a photo hold is the wrong answer on the ship. Zero tolerance — literally `assert.equal(census[forbidden], 0)`. |
| **Boy and girl twins differ ONLY in their six `COLOR_*` constants** | Otherwise the reveal shows a different *show* depending on the answer, which the crowd reads as favouritism. The check is a source diff with those six lines and the one prose colour word stripped. |
| **Keep a brightness floor** | Everything stays lit and classifiable; it is also what keeps both tease families above the 40-pixel floor. |

Two measured floors, both swept over 5 s rather than sampled at two instants:

- **Animated**: peak per-pixel delta ≥ 40 **and** mean-frame delta ≥ 1.0.
- **Distinct from every sibling in its family**: mean delta > 1.5 at t = 5 s.
  This is deliberately low — it catches a copy-paste duplicate, it does not
  demand that twenty looks be maximally different. Two sparse point-fields
  legitimately sit near it, so give a new look its own *motion*, not just its
  own parameters.

Sliders are declared in MFT knob order (`.agent/memory/pattern-param-order.md`);
whatever you export becomes the playlist entry's `defaults` block in step 4.

## 3. Register it in the manifest

Qualified `baby/…` ids only reach the operator's pattern picker if they are in
`marsin_engine/patterns/manifest.json`.

`baby` is already a registered directory in
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
simulation/scenes/titanic/playlists/<baby_tease|baby_boy|baby_girl>.yaml
simulation/scenes/test_bench/playlists/…      ← must be BYTE-IDENTICAL
```

Every family member must appear in its playlist. The order is a curated show
arc rather than a filename sort: Tease should read calm -> curious -> kinetic,
and Boy/Girl must carry the same concept order so the answer changes only the
colour. Each entry's `defaults` must name **exactly** the sliders the pattern
actually exports. A default naming a slider that does not exist lands on
nothing and looks like a retune. These facts are asserted per entry.

The playlist is also what the SPECIAL EVENT arms, and the runner refuses to ARM
if a playlist is missing or has no loadable entry — so an unregistered pattern
is a dead show, not a cosmetic diff.

## 5. Regenerate the gallery

```bash
node marsin_engine/tools/playlist_gallery/generate.mjs --playlist baby_tease
node marsin_engine/tools/playlist_gallery/generate.mjs --index-only
```

Qualified ids need no special handling — the generator already walks
subdirectories and sanitises the `/` for media filenames only
(`001_baby__46_tease_….gif`). Add a one-line intent for the new id to
`marsin_engine/tools/playlist_gallery/pattern_goals.json`.

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
consistent end to end. The failures are written to name the file and the reason.

## What is deliberately NOT enforced

- **How many** patterns a family has. Floors stop a silent shrink; there is no
  ceiling and no target.
- **The numbering layout.** Blocks may be laid out however the authors like.
- **Tease pattern rotation timing.** That is show data, not pattern data — the
  `autopilot:` block on the tease stage of
  `simulation/scenes/titanic/special_events/baby_reveal.yaml`, retunable live
  from the CaptainPad SPECIAL EVENTS tab while the show runs.
