# _269 — Ambient Extra pattern factory and White tuning campaign

**Role:** Pattern Manager / curator. **Scope:** show content only: 50 Ambient
Extra sources, five White sources, exact saved playlist values, gallery intent
metadata/tooling, generated review media, and content-scoped tests. No git,
live services, ports, runtime state, CaptainPad, engine internals, launcher,
states, simulation/server behavior, UI, or infrastructure were touched.

## Outcome

The 50-pattern Ambient Extra audition family and five-pattern White review
family now have exact-current, seekable 40-second/8-fps Titanic galleries.
Every row exposes its visual concept, design intent, reason for existence,
Titanic goal, fixture roles, full TE-sign and Jewelry-white treatment,
plain-language controls, restrained audio suggestions, exact saved/effective
values, and review state.

Ambient Extra review state is **30 READY FOR OPERATOR / 19 TUNE / 1 REJECT**.
White remains **5 TUNE** for operator taste and physical Bench Mirror review.
These are content-review states, not playlist blessing or show scheduling.

- READY: 01–06, 08–09, 11–26, 28–30, 47–49.
- TUNE: 07, 10, 27, 31–44, 46, 50.
- REJECT: 45 Moss Islands.
- White TUNE: 60 White Wash, 61 White Breathe, 62 White Shimmer,
  63 White Chase, 64 Temple Warm White.

## Content and contract changes

- All 50 `marsin_engine/patterns/ambient_extra/*.js` sources and White sources
  `60_white_wash.js` through `64_temple_warm_white.js` were reviewed and
  campaign-tuned while preserving qualified IDs, filenames, playlist entry
  IDs, exported slider names/order, and code defaults.
- Every Ambient Extra playlist entry saves exactly `sliderLocalSpeed=0.6` in
  both Titanic and test-bench mirrors; all other controls use code defaults and
  modulation/MIDI lists remain empty.
- All 55 patterns author each physical 40+34 TE sign as one complete
  `index % 74` surface. The pair is byte-identical, addresses 40–73 do not
  repeat 0–33, and the surface remains dynamic.
- All 55 sources rely on model-injected `FIX_*` capabilities. Numeric
  self-declarations were removed, so a model missing required hardware now
  fails loudly instead of silently falling back.
- Native white remains fixture-authored and W=A byte-identical; UV is zero in
  every non-UV pattern. White looks keep Jewelry hero whites, Hull material,
  Silhouette contour, Organ punctuation, and full-surface Identity treatment.
- Deep Window's final signed shared-center cadence passes direction truth:
  TRUE 7 / UNKNOWN 1 / zero WEAK, WRONG, or DEAD. Rolling Shutters is TRUE 6 /
  UNKNOWN 1 / zero bad classifications. White Wash direction is TRUE.

## Durable intent and gallery tooling

Tracked source of truth:

- `marsin_engine/tools/playlist_gallery/pattern_goals.json`
- `marsin_engine/tools/playlist_gallery/generate.mjs`
- `marsin_engine/tools/pattern_audio_harness.mjs`
- `simulation/scenes/titanic/playlists/ambient_extra.yaml`
- `simulation/scenes/test_bench/playlists/ambient_extra.yaml`

Gallery schema 3 is closed and fail-loud. It validates structured intents,
control order/defaults, saved/effective values, evidence, uniqueness review,
audio targets, playlist/source/goal fingerprints, transactional publishing,
and campaign readiness. Intent campaigns are not marked ready unless media is
at least 40 seconds at 8 fps and matches current playlist, source, and goal
digests. The generator stages outside the source tree and publishes only a
complete gallery. `--skip-index` and `--index-only` allow multiple campaigns
to render before rebuilding the master index once.

Content tests added/extended:

- `marsin_engine/tests/patterns/ambient_extra_contract.test.js`
- `marsin_engine/tests/patterns/white_pattern_intent_contract.test.js`
- `marsin_engine/tests/patterns/te_sign_surface_contract.test.js`
- `marsin_engine/tests/patterns/playlist_gallery_tool.test.mjs`

## Final gallery artifacts

- Master: `docs/pattern_gallery/index.html`
- Ambient Extra: `docs/pattern_gallery/playlists/titanic/ambient_extra/`
  (`manifest.json`, `index.html`, 50 GIFs, 50 MP4s)
- White: `docs/pattern_gallery/playlists/titanic/white_only/`
  (`manifest.json`, `index.html`, five GIFs, five MP4s)

Both manifests are schema 3, 40 seconds, 8 fps, and contain exact intent,
saved/effective values, source digests, playlist digest, and goal digest.
Every MP4 is a seekable 1440×330 three-view composite (TOP X/Z, FRONT X/Y,
IDENTITY TE signs); every referenced GIF and MP4 exists and decodes.

Final visual QA sampled all published MP4s at 0/8/16/24/32 seconds. Contact
sheets are in `C:/Users/Titanic's End/tmp/final_gallery_contacts/`. No broken
view, blackout, dark latch, repeated sign lower half, or flat whole-rig White
wash was observed. The 31–44 and 46/50 silhouettes remain deliberate operator
taste decisions, reflected by TUNE rather than overstated readiness.

## Validation

Final frozen-tree command:

```text
node --test tests/patterns/ambient_extra_contract.test.js tests/patterns/white_pattern_intent_contract.test.js tests/patterns/te_sign_surface_contract.test.js tests/patterns/white_amber_lane_match.test.js tests/patterns/specialty_white_uv.test.js tests/patterns/playlist_gallery_tool.test.mjs tests/patterns/param_truth_smoke.test.js
```

Result: **188/188 PASS**. This covers ordered family and playlist parity,
structured intent schema, both-model compile, full physical TE surfaces,
W=A/UV, White specialty behavior, transactional/fingerprinted gallery
readiness, and offline parameter-truth smoke. Final exact Deep Window
full-track gate also passes on 964/964 lit pixels, dark fraction 0.00,
3.18 ms mean, and no latch.

Gallery commands:

```text
node tools/playlist_gallery/generate.mjs --scene titanic --playlist ambient_extra --seconds 40 --fps 8 --skip-index
node tools/playlist_gallery/generate.mjs --scene titanic --playlist white_only --seconds 40 --fps 8 --skip-index
node tools/playlist_gallery/generate.mjs --index-only
```

Both transactional renders and the single index rebuild passed. Manifest/file
audit found zero missing assets; master index marks both Titanic galleries
ready and contains no stale marker.

A final cold read-only validator independently returned **PASS with zero
blockers**: 55 manifest rows and their review-state counts match, all 110
GIF/MP4 files fully decode to 320 frames/about 40 seconds, current
source/playlist/goal fingerprints match, exact saved/effective values and
intent sections are present, HTML playback has no autoplay, the master index
marks both campaigns ready, six contact sheets passed visual review, and its
focused suite passed 19/19. Scratch report:
`C:/Users/Titanic's End/tmp/final_gallery_validator.md`.

## Rejection and remaining risks

`45_moss_islands` is the sole rejection. It is safe, dynamic, TE-complete, and
parameter-truth clean, but its current sparse green plateau/coast read is not
an unequivocal island/merger object. More importantly, an isolated 40-second
Titanic run measured **8.82 ms mean / 17.93 ms worst**, failing the 6.25 ms
per-channel budget. It must be materially reauthored and re-proven; it must not
be promoted by brightness or metadata alone.

All other non-READY entries remain TUNE for gallery/physical taste, not hidden
technical failures. No Ambient Extra or White playlist is blessed until Sina
reviews the final gallery and surviving rows pass the physical Bench Mirror.

One implementer accidentally invoked a variation generator while probing its
help behavior. It regenerated five unrelated gallery widgets at 17:57 local:
`00_golden_hour_wash__static.html`, `00_golden_hour_wash__sound.html`, their two
Titanic variants, and `01_cylon_sweep__static.html` under
`marsin_engine/tools/gallery/widgets/`. They were preserved in the shared
dirty tree and are not part of this gallery acceptance claim.
