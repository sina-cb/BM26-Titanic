# 2026-06-21 — Adversarial review + fix: CaptainPad AUDIO surface + audio docs/reports

Reviewer + fixer pass on `dev/r3_captainpad_docs` (worktree off
`feat/audio_analysis_2`). Scope: the CaptainPad AUDIO files
(`app/(tabs)/audio.tsx`, `components/audio/*`, `components/Modulation.tsx`,
`utils/audioSignals.ts`) + audio-doc/report consistency
(`.agent/plans/20260620_0`/`_1`, the `2026062*` audio reports). Out of scope
(other agents): `marsin_engine/audio/*`, non-audio CaptainPad tabs.

Bar met: `npx tsc --noEmit` exit 0 · `npm run lint` exit 0 (12 pre-existing
warnings, **0** in owned files) · `npm run web:build` exit 0 (the `/(tabs)/audio`
route built) · clean `git status` (only `utils/audioSignals.ts` changed; `dist/`
gitignored).

## FIXED (committed)

1. **`audioAccentHex` word-segment band-token match (real mis-colour bug).**
   `utils/audioSignals.ts` resolved a signal's identity colour with a bare
   `key.toLowerCase().includes(token)`. That is exactly the substring fragility
   the file's own `keyHasBandToken` helper was written to kill: `audioSlowZone`
   contains the substring `low` (inside "s-**low**-zone"), so it resolved to the
   **LOW band's teal** instead of its own `slow` cyan (`#5ac8fa`). Routed live
   (`audioSlowZone`, OSC `/marsin/audio/slow`), so the deck meter / audio-tab
   trace / modulation source trail all painted the slow-zone signal the wrong
   identity colour. Fixed by routing `audioAccentHex` through `keyHasBandToken`
   (word-segment match). Verified no regression: every intended match still
   resolves (`micLow→low`, `audioBuildScore→build`, `audioEnergyRatio→energy`,
   `audioBpm→bpm`); `dom1`/`dom2` tokens matched under NEITHER scheme before
   (they fall through to the frequency→violet branch as designed), so no change
   there. Function is a hoisted declaration, so referencing `keyHasBandToken`
   defined lower in the file is safe at runtime.

2. **Pulse-key list completeness: added `audioDownbeat`.**
   `PULSE_KEY_TOKENS` was missing `downbeat`. `audioDownbeat` is a genuine
   one-frame pulse — `marsin_engine/audio/signals/bpm_tracker.js` sets
   `downbeat = true` only on the hop beat-1 fires, and `derived_signals.js`
   publishes it as `1.0/0.0`; it is a ROUTED signal (`audio_signals.js`:
   `audioDownbeat`, range `[0,1]`, 30 Hz, `kind: 'intensity'`). Without the
   token the AUDIO tab would render it as a flat-lining `[0,1]` bar — the exact
   bug `isPulseKey` exists to prevent (Adv-D P2-A). F3 (report `20260620_28`,
   verification F3 line 238) shipped 10 pulse keys and did not classify
   `audioDownbeat` either way (it is in neither the 10 pulse keys nor the 14
   tested continuous keys), so this is an additive completeness fix, not a
   contradiction of any verified claim. Added `'downbeat'` with a clarifying
   comment.

## VERIFIED CONSISTENT — no change needed

- **Genre name lockstep.** CaptainPad `AUDIO_GENRE_NAMES` matches the engine's
  `GENRE_NAMES` (`genre_classifier.js`) exactly: 7 names, identical order
  (ambient, deep_house, melodic_house, tech_house, techno, melodic_techno,
  downtempo).
- **Genre accuracy in docs.** Final summary `20260620_29` says 63.9%; the
  verification log (source of truth) confirms **63.9% deployed @ fft2048**
  (the 44.4% was a corrected instigator harness-fftSize error, log lines
  180–195). Reconciled. No stale 44.4% / 22% claim survives in the final
  summary.
- **Pulse infra.** `PulseFlash.tsx` / `AudioTraceCanvas.tsx` arm-on-edge +
  frame-normalised decay, congestion-aware (no new subscriptions), fail-loud on
  missing palette tokens (no fallback). `Modulation.tsx` engine-mirrored
  transfer math matches the documented contract.
- **Doc file references.** All file paths cited in the scoped reports resolve
  (`PulseFlash.tsx` at `components/audio/`, `audio_analyzer.js`, `genre_eval.mjs`,
  the test files, the `20260617_0` contract, etc.). No broken internal refs.
- **Dynamic-signal handling for new keys** (chroma/riser/climax/silence/etc.):
  the strip is schema-driven (`useAudioSignals` → `toSignalSlot`); new continuous
  keys render as bars+trace with no code change. Correct by construction.

## FLAGGED FOR OPERATOR DECISION (not changed)

1. **`audioBeatInBar` mis-classified as a pulse (pre-existing).**
   `isPulseKey` matches the `beat` token via substring on the joined key, so
   `audioBeatInBar` → `audiobeatinbar`.includes('beat') → **true**. It is a
   routed signal (`audio_signals.js`, range `[0,4]`, `kind: 'intensity'` since
   max < 1000), so it would render as a PulseFlash DOT instead of a 1–4
   beat-position bar. The clean fix is to make `isPulseKey` boundary-aware like
   `keyHasBandToken`, but the multi-word pulse tokens (`onsetlow`, `chesthit`,
   `dropcountdown`, `phraseboundary`, `trackchange`, `switchcolor`,
   `switchpattern`) are matched ACROSS segment boundaries, so a pure
   word-segment matcher would stop matching them — the rewrite needs care and
   could have edge effects. <90% sure it is side-effect-free → flagged rather
   than rewritten. (My `downbeat` addition does not touch this: `audioBeat` /
   `audioDownbeat` are both already-correct pulses; the collision is only
   `audioBeatInBar`.)

2. **Two duplicated constants (cosmetic, intentional-by-comment).**
   `ACCENT_AUTO = '#1b9e77'` is defined locally in `audio.tsx` (line 62) AND
   exported from `audioSignals.ts`; `makeCard(palette, …)` ignores its `palette`
   param (spreads only `globalStyles`). Both are documented as deliberate (theme
   shape-resilience) and load-bearing in live UI. De-duping is behavior-neutral
   but ripples imports / 3 call sites for no functional gain — left as-is. Flag
   only if a future DRY pass wants them collapsed.

## Result
2 fixed (committed), 2 flagged. tsc exit 0 · lint exit 0 · web:build exit 0.
