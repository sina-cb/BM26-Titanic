# Ambient Extra 30/30 speed and motion pass

## Outcome

The 50-pattern `ambient_extra` candidate family is calibrated for the
operator's Ambient review point: Global Speed 0.30 and Local Speed 0.30.
The two scene playlists remain byte-identical and save only
`sliderLocalSpeed: 0.3` with empty modulation and MIDI maps.

All 50 sources now use a bounded monotonic local-speed response chosen so the
0.30 operating point has meaningful motion without making the upper half of
the slider dangerously fast. `23_needle_gauge` and `32_silent_meteor` retain
their identity-specific clock implementations with equivalent calibration.

## Artistic pass

The distance-readable foreground is deliberately simple while the material
behind it remains mathematically detailed:

- left-to-right passages: `02_brass_compass`, `44_healing_cracks`,
  `47_side_by_side`, and `50_last_lantern`;
- broad rolling focus: `03_pearl_chain`;
- top-to-bottom canopy passage: `43_leaf_turn`.

Sparse or event-driven patterns received identity-specific TE-sign material
and/or a restrained whole-model carrier field where measurement showed the
original composition was too local: 05, 06, 07, 17, 21, 22, 23, 24, 26, 31,
33, 34, 36, 41, 46, and 48. Both physical 74-pixel signs remain exact paired
surfaces. Palette ownership and native-white policy were not broadened.

## Durable contracts

`te_sign_surface_contract.test.js` now evaluates Ambient Extra for 40 real
seconds at 10 Hz with an explicit Global 0.30 / Local 0.30 clock. It requires:

- byte-exact equality between the two physical signs;
- complete 74-pixel surface continuation rather than a repeated 40-pixel map;
- TE mean temporal range at least 35 bytes;
- at least 65% of TE pixels moving by at least 20 bytes;
- whole-model mean temporal range at least 30 bytes;
- at least 40% of the complete model moving by at least 20 bytes.

All 50 Ambient Extra patterns and all five white patterns pass the resulting
55-case suite. The family contract also pins playlist parity, Local 0.30,
portable compilation, W=A, UV=0, audio metadata, and structured gallery intent.

## Gallery parity

The offline audio harness accepts an explicit `--time-scale`. The playlist
gallery exposes it as `--global-speed`, records it in the manifest, and prints
it in the gallery header. This prevents an Ambient review gallery from silently
playing the pattern clock at 100% when the operator asked to judge 30%.

Permanent review artifact:

`docs/pattern_gallery/playlists/titanic/ambient_extra/index.html`

It contains 50 fresh 40-second GIFs and 50 seekable MP4s at 8 fps with
`globalSpeed: 0.3`. The combined gallery index was rebuilt after atomic publish.

## Validation

- `node --test tests/patterns/ambient_extra_contract.test.js`: 5/5 pass.
- `node --test tests/patterns/te_sign_surface_contract.test.js`: 55/55 pass.
- `node --test tests/patterns/playlist_gallery_tool.test.mjs`: 13/13 pass.
- `node --test tests/patterns/white_amber_lane_match.test.js`: 60/60 pass.
- 50-item gallery manifest/media audit: 50 GIF, 50 MP4, 40 s, 8 fps,
  global speed 0.30.
- Cross-model parameter-truth sweep: 50/50 compile; 242 TRUE,
  90 UNKNOWN_CLAIM, 12 WRONG, 5 WEAK, 2 Titanic-unreachable controls that are
  alive on test_bench. Evidence is in
  `~/tmp/ambient_extra_param_truth_30.{json,md}`. These control findings remain
  honest tuning debt; they were not hidden by changing the analyzer.

## Files in scope

- `marsin_engine/patterns/ambient_extra/01_harbor_glass.js` through
  `50_last_lantern.js` (speed calibration; the artistic subset is listed above)
- `simulation/scenes/{titanic,test_bench}/playlists/ambient_extra.yaml`
- `marsin_engine/tests/patterns/{ambient_extra_contract,te_sign_surface_contract}.test.js`
- `marsin_engine/tools/pattern_audio_harness.mjs`
- `marsin_engine/tools/playlist_gallery/{generate.mjs,pattern_goals.json}`
- `.agent/projects/pattern_curation_and_playlist_blessing.md`
- `docs/pattern_gallery/playlists/titanic/ambient_extra/**`
- `docs/pattern_gallery/index.html`

No git operation, live service, show port, launcher, or runtime state was used.
The family remains DRAFT / UNBLESSED pending gallery review and physical bench
mirror blessing.
