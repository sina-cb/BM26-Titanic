# MIDI implementation — 8-angle review findings (for Fable to plan)

**Date:** 2026-07-02 · **Reviewed:** `f9299bfe..HEAD` on `feat/captainpad-midi-control`
(the MFT driver + 8 correctness fixes + hook snapshot + mixer UI + engine upsert)
**Method:** 8 independent finder angles (line-by-line, removed-behavior, cross-file,
reuse, simplification, efficiency, altitude, conventions), self-verified with
quoted lines. Deduped + ranked below. **Nothing here is committed as a fix yet —
this is the input to task planning.**

Baseline is green (tsc 0 · 201 vitest · engine 9/9 · lint 0 · web:build) — every
item below is a latent/edge issue, not a broken build.

## P1 — correctness (fix before trusting the MFT on the bench)

1. **MFT knob index ≠ on-screen slider order.** The hook's `focused.exports`
   (which knob *i* drives as `exports[i]`) excludes `cpcOwned` and non-numeric-`v0`
   exports; but the deck (`GlobalParams.tsx`) and mixer (`mixer.tsx` MixerLocalParams)
   render ALL `kind===1` sliders inline, incl. disabled MATCHED rows. So when a
   matched/cpc slider precedes a learnable one, knob N drives a *different* param
   than the Nth visible slider — knobs silently off-by-k with no cue. **Fix
   direction:** make the on-screen learnable order and the knob order come from ONE
   shared derivation (exclude matched/v0-less from the knob-mapped list, or show the
   knob's param name on screen / on the ring). *(cross-file)*

2. **Focus reconcile gap (mixed touch + MIDI).** `requestedFocusLayer` is only
   cleared inside `applyBinding` (`reconcileRequestedFocus`); `isFocusLocked` and
   `getRequestedFocusLayer` read the raw field. If focus changes via the on-screen
   FOCUS button or an MFT side button and no *bound fader* is then moved, the stale
   request drives the focus LED, swallows mixer faders as "settling," and makes
   `focusStep` off-by-one. **Fix:** one derived `effectiveFocusLayer(snap)` that all
   three readers use (clears the request whenever the snapshot already matches or the
   layer is gone). *(simplification + altitude + line-by-line, 3× independent)*

3. **Relative-delta undershoot on fast turns.** Each ~33 ms coalescer window re-reads
   the anchor from the snapshot (`exp.base ?? exp.v0`); the engine echo that updates
   the snapshot lags a network round-trip, so successive windows base off a stale
   value and inter-window motion is lost — a fast MFT sweep applies far less than it
   turned. **Fix:** track a local optimistic applied value in the runtime (seed from
   snapshot, add accumulated deltas, re-seed only on meaningful divergence). *(line-by-line)*

4. **BPM-sync gate asymmetry.** The "speed knob inert + ring strobes while BPM→Speed
   sync owns speed" rule exists ONLY on the MFT relative path (`flushResolved`,
   `key==='speed'`); the APC's fader-7 (`paramCenter speed`, absolute) dispatches
   `updateParamCenter({speed})` unconditionally — so under sync the fader writes speed
   and the next audioBpm tick clobbers it (visible fight), and docs/34 wrongly claims
   the two surfaces match. **Fix:** gate at the shared depth (dispatcher `paramCenter`
   case, or a `syncOwnedKeys` snapshot fact derived from the CPC schema) so both
   surfaces agree; drop the magic-string `'speed'` duplicated across manager + projector. *(altitude)*

5. **Learned-fader pickup uses `v0`, not `base`.** `applyBinding` soft-takeover
   compares the incoming fader against `exp.v0`, but for a modulated param `v0` is the
   moving modulated value (the delta path deliberately switched to `exp.base`). Pickup
   crossing is computed against an oscillating target → the fader never reliably
   unlocks (or unlocks at a wrong crossing and jumps). **Fix:** pickup against
   `exp.base ?? exp.v0`, consistent with the delta path. *(line-by-line + removed-behavior)*

6. **MFT ring shows `v0`, knob edits `base`.** Ring feedback reads `exports[index].v0`
   while the knob shifts `base`; for a modulated param the ring races the audio and
   never reflects the value the knob actually controls. **Fix:** ring reads
   `base ?? v0` (same anchor the knob edits); the *pulse* animation already signals
   "modulated." *(removed-behavior + line-by-line)*

7. **Reset vs turn coalescer key race.** Encoder-push reset pushes coalescer slot
   `knob:${index}`; a same-encoder turn accumulates under the profile control id
   (`knob_N_turn`). Different slots → a trailing turn-window flush can land *after* the
   reset and clobber it (spin-then-immediately-press). **Fix:** one key namespace per
   physical encoder (or make reset cancel the pending turn window). *(removed-behavior + line-by-line)*

## P2 — fail-loud (codex P0) + latent

8. **Silent fallbacks.** `combineDelta`'s `return incoming` on "impossible" mismatched
   kinds silently degrades to last-write-wins (drops detents — the exact thing
   `accumulate` prevents) — should `throw` like the sibling dispatch guard.
   `flushResolved`'s unknown-CPC-key branch (`typeof cur !== 'number' → return`)
   swallows a real profile/engine mismatch with no status, while the adjacent
   sync-gate branch *does* `setStatus`. **Fix:** throw / status, per "fail loudly." *(conventions)*

9. **Latent stale-LED on `led.channel` change.** The new `LedState` key is
   `status:number` and the status byte embeds the LED channel; if a control's
   `led.channel` differs between active/idle states, the old-channel note is never
   sent an "off" and its physical LED sticks. **No current profile varies channel**
   (APC pads use channel 6 for both), so latent — but a footgun for future profiles
   (and the VSN1). **Fix:** clear by (status,note) or emit off for the prior channel. *(line-by-line)*

## P3 — efficiency (iPad perf + hardware wear)

10. **Snapshot full rebuild at CPC-broadcast rate.** The snapshot effect now depends on
    `engine.sharedParams`, so every CPC broadcast (10-30/s during any slider/knob sweep)
    triggers the full async rebuild (`Promise.all` fetchPlaylist over N channels + entry
    scan + `onEngineUpdate`) just to refresh `globalParamValues`/`bpmSpeedSyncOn`. **Fix:**
    mirror shared values into a module cache via the existing params bus and patch
    `_snapshot` in place + `_nudge()`, dropping the dep. *(efficiency)*

11. **Sysex config storm on every hotplug.** `connect()` re-sends the full 64-encoder
    `buildConnectConfig()` on every `endpointsChanged`, and that fires for ANY controller's
    plug/unplug (incl. the APC's). On a flaky playa hub each event blasts a multi-KB sysex
    write to the MFT (real config/EEPROM writes → flash wear + mid-set ring disruption).
    **Fix:** push config only on a real disconnected→connected transition for *that*
    device; hoist the deterministic frames to a module const. *(efficiency)*

12. **Render/allocation churn (lower):** `useMidiFocus()` in every `ChannelStrip`
    defeats `React.memo` (all strips re-render on any focus step — use a per-strip
    `useIsMidiFocused(i)` selector); per-detent `setStatus` fires React re-renders at raw
    MIDI rate before the coalescer (update `lastEvent` at flush cadence);
    `projectLeds` builds ~54 CC arrays + strings before diffing every frame (diff on
    numeric keys, compare before constructing). *(efficiency)*

## P4 — architecture (do BEFORE driver #3 / VSN1 lands)

13. **The device-agnostic core has grown MFT-family knowledge.** `manager.ts` hard-imports
    `decodeBankChange` (run as step-0 of `onMessage` for EVERY controller),
    `buildConnectConfig` (hardwired to the generic `configureOnConnect` flag), and
    `focusedIdentityColor`; `led_projector.ts` special-cases MFT ring/animation output by
    action kind. Adding the VSN1 (its own connect config / LED-screen feedback) means
    *another* special path. **Fix direction:** a small per-driver seam declared on/beside
    the profile — `onConnectFrames()`, `decodeExtras()`, and a profile-level LED-feedback
    spec — so the runtime stays generic. This is the highest-leverage refactor because
    driver #3 is now committed. *(altitude, confirmed relevant by the VSN1 lock)*

## P5 — cleanup (low, batch when touching the file)

- Dup `clamp01` (manager) / `clampUnit` (led_projector) — one shared unit-clamp.
- Dead MFT code: `selectBank`, `decodeEncoderTurn`, `decodeEncoderPush`,
  `decodeSideButton` + the `SideButtons` machinery have no production callers (side
  buttons route through profile matching, not the decoder).
- `mft.yaml` 32 near-identical knob/push entries — a `cc`-range match (like the pad
  `column` type) collapses bank 1 to a few entries (needs a resolver range-match add).
- `midiByTarget` `target.parameter` index hand-rolled in mixer.tsx + GlobalParams.tsx —
  shared `indexByTargetParameter`.
- Second `modulationState` subscriber (`_modState`) duplicates `useModulationState` —
  one shared module store.
- `FocusedChannel.entryId` never read (the `key` string already embeds it).
- Stale TODO at `manager.ts:~478` claiming reset-default plumbing is missing — it
  shipped; delete it.
- Engine test `putMidiMapping` helper copy-pastes the route's upsert filter ("kept in
  lockstep") — factor `upsertMidiMapping(entry, incoming)` onto PlaylistManager and call
  it from both route and test.
- PATCH `/midi-mappings` is asymmetric with PUT (no upsert-by-target; a target-mutating
  PATCH 400s via the save() backstop). UI can't trigger it; note or unify.
- The hook's `_lastEngineChannels`/`_lastEngineDeck`/`_activePlaylistNames` machinery is
  a lot for a rare-event (playlistSaved) filter with no measured cost.

## Verified SAFE (do NOT spend time here)
- Dispatcher `throw` for runtime-only kinds can't fire in production (runtime intercepts
  every path incl. coalesced flush).
- Sysex permission ordering is correct (`setSysexRequested` precedes the only
  `getAccess`; `MidiConfigSection`/`isMidiAvailable` don't touch access).
- `decodeBankChange` can't eat a legit control (ch3 CC0-3@127 disjoint from side buttons
  CC8-31; APC is ch0).
- Connect opens source+dest before the sysex push; APC (no `configureOnConnect`) gets 0 frames.
- Encoder push resolves DISCRETE (fires once on press, release dropped).
- `led_projector` reuses the `mft/messages` builders (not hand-rolled bytes).
- `focusedIdentityColor` has no pre-existing home to reuse.

## One decision for Sina (not a code fix)
Branch `feat/captainpad-midi-control` is kebab-case; the codex says `feat/<snake_case>`.
Renaming a pushed branch needs the GitHub-rename flow (never delete+recreate). Your call
whether it's worth it.
