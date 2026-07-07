# og_patterns — original 00–25 backups

Snapshots of patterns **00–25 as they were on `main`** before the
`feat/highdef_patterns` branch retuned them (ground-rule / white / audio-
reactivity pass). Kept purely as a **safety net**: the retuned versions in
`../patterns/` haven't been fully tested on the rig yet, so these originals are
preserved for comparison and quick rollback.

- **Source:** `origin/main` (`marsin_engine/patterns/NN_*.js`), byte-identical.
- **Not loaded by anything.** This dir is a sibling of `patterns/`, not under it,
  so the engine / gallery / harness never scan or resolve these — they are inert
  reference copies, not live patterns.

## Rolling one back

If a retuned pattern misbehaves on the rig, restore its original with:

```bash
cp marsin_engine/og_patterns/NN_name.js marsin_engine/patterns/NN_name.js
```

(Then re-verify with `node tools/gallery/gen_variations.mjs --pattern NN`.)

## Cleanup

Once the retuned 00–25 are validated on hardware, this whole directory can be
deleted — it exists only for the transition.
