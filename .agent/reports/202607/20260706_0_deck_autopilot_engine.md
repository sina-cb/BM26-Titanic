# Slot 0 — deck_autopilot_engine

- **Branch:** `dev/deck_autopilot_engine` (local only — never pushed)
- **Parent branch:** `feat/autopilot_deck_improvement` (tip `3a76b92` at report time)
- **Worktree:** `~/workspace/BM26-Titanic-worktrees/deck_autopilot_engine`
- **Slot ports:** engine API/WS `31068`, engine OSC `31000` (HIL tests self-boot on 31068)

## Scope

The ENGINE slice of the autopilot + deck improvement plan. Three ordered
phases, all landed:

- **E1** — Autopilot **profile seam** + per-scene persistence + REST/WS. The
  deck autopilot becomes a set of named profiles; today's behaviour is the
  `random` profile, proven **byte-identical** to the legacy picker.
- **E2** — **`audio_reactive`** profile: event-driven pattern advance, an
  energy-arc speed ramp, and colour on *stable* state — driven from live Audio
  Companion signals. Includes the operator's two follow-up behaviours
  (energy-arc + colour-on-stable-descriptor).
- **E3** — deck **split-playlist slots**: two stacked, browsable panes over the
  existing single-live-pattern deck. Plus the E1 `GET /autopilot` fix the
  CaptainPad contract audit flagged.

## Files changed (`git diff --name-status feat/autopilot_deck_improvement..HEAD`)

```
M  marsin_engine/lib/api_server.js
M  marsin_engine/lib/autopilot.js
A  marsin_engine/lib/autopilot_pick.js
A  marsin_engine/lib/autopilot_profiles/audio_reactive_profile.js
A  marsin_engine/lib/autopilot_profiles/profile_registry.js
A  marsin_engine/lib/autopilot_profiles/random_profile.js
M  marsin_engine/package.json
A  marsin_engine/tests/audio_reactive_profile.test.js
A  marsin_engine/tests/autopilot_profiles.test.js
A  marsin_engine/tests/hil/hil_audio_reactive_profile_test.mjs
A  marsin_engine/tests/hil/hil_autopilot_profile_test.mjs
A  marsin_engine/tests/hil/hil_deck_playlist_slots_test.mjs
M  tools/port_cleanup.cjs
```

> NOTE: the raw `git diff` against my worktree *base* (`0252d37`) also shows
> `M .agent/projects/autopilot_profiles_audio_reactive.md`. **I did not touch
> that dossier.** It appears only because the parent tip advanced to `3a76b92`
> (the operator's energy-arc dossier update) while my branch is based on the
> older `0252d37`. My branch's version of that file is the merge-base version,
> so a merge takes the parent's newer version cleanly — **no conflict, no
> action needed**. The name-status above is filtered to `marsin_engine`/`tools`
> (my real diff).

## Commits on this branch

```
3df5966 feat(engine): deck split-playlist slots + GET /autopilot profile fields (E3 + E1 fix)
30d62d5 feat(engine): audio_reactive autopilot profile — energy-arc + stable-color (E2)
908f9be feat(engine): autopilot profile seam + per-scene persistence + REST/WS (E1)
```

## Spike 0 finding (REQUIRED — pulse survival vs OSC throttle)

**`audioSwitchPattern` / `audioSwitchColor` are SINGLE-HOP pulses at the
source, and the Companion OSC throttle CAN drop them. The profile therefore
triggers LEVEL-wise ("value > 0 observed" + a profile-side minInterval
re-guard), NOT on a strict rising edge.**

Evidence:
- `audio/signals/switch_signals.js:106-107` sets `switchPattern`/`switchColor`
  to `false` at the top of every `update()`, and to `true` only on the firing
  hop (`_firePattern`, `:233-236`; the colour block `:209-219`). So each event
  is a one-hop pulse — there is no hold-width on the wire.
- The analyzer runs ~86 hops/s; the Companion emits OSC through a **phase-
  accumulator throttle** defaulting to ~60 Hz (`companion_server.js:145-172`,
  `sendOsc` returns early on a non-send hop, `:235-256`). Roughly 1 in 4 hops
  is dropped, and a pulse landing on a dropped hop is **lost** — the value is
  only "re-sent next frame" if it's still 1, but the source has already reset
  it to 0.
- Conclusion: an edge detector would miss ~25% of cues. The profile reads the
  pulse level off the change event (`_pulseHigh`) and re-guards with its own
  `minIntervalMs`, so a dropped pulse just means the *next* cue advances.

Signals I could NOT use (called out per the brief):
- **No spectral centroid** inbound (`micChromaTiltRaw` is engine-internal, no
  OSC binding) — palette *temperature* mapping is out of v1. Adding it needs a
  registry entry + a Companion emit.
- **No per-entry energy/mood metadata** on playlist entries — the profile
  biases *selection strategy* (shuffle vs group), not semantic energy matching.
- The **structure detector** is "disabled by default, under development"
  (`audio/README.md`), so `audioStructure` is used only as a soft corroborator
  in the colour descriptor, never as a hard trigger.

## Tests run + results (HONEST)

All green. Unit tests via `node --test`; HIL tests **self-boot** the engine on
`31068`, snapshot the per-scene state + `config.yaml`, run, stop the engine,
and restore in a `finally` — so **`git status` is clean after every run**
(verified: zero tracked-state side effects).

- **Unit (56 pass / 0 fail):**
  - `tests/autopilot_profiles.test.js` — 15 tests. Pins **`random` profile ==
    legacy `pickNextAutoCycleEntry`** for a seeded RNG across sequential /
    shuffle / group-locality; registry list/default/normalize
    (absent→default, unknown→throw); factory; interface shape.
  - `tests/audio_reactive_profile.test.js` — 16 tests. attach/detach
    bpmSpeed restore; pulse advance + minInterval + silence/party gates;
    **energy arc** (ceiling sags on a calm, recovers on a rise); **energy
    pickup** advance (minInterval-honoured, no double-fire with a pulse);
    **colour**: a bare transient does NOT recolour, a held descriptor change
    DOES (circular hue distance); max-dwell safety; pick bias.
  - `tests/auto_cycle.test.js` — 25 tests (pre-existing) still green (my
    picker extraction + re-export preserved every import path).
- **HIL — `hil_autopilot_profile_test.mjs` (16/16, engine 31068):** no-profile
  arm behaves as before; `autopilot` broadcast + connect-replay carry
  `profile:'random'` + `profiles`; **GET /autopilot** carries profile/profiles
  AND does not leak `profiles` into the persisted ref; switch to
  `audio_reactive`; per-scene persistence on the deck channel; unknown→400
  (stored value untouched).
- **HIL — `hil_audio_reactive_profile_test.mjs` (11/11, engine 31068):** arms
  `bpmSpeedSync=1`; a `audioSwitchPattern` pulse advances; a **bare
  switchColor transient does NOT recolour**; a **held descriptor change DOES**
  (`h 0.92 → 0.03`, exactly `sunset_coral` c1=0.03 for noteHue 0.05); **energy
  arc** sags the ceiling (157→92) then recovers (92→146); an **energy pickup**
  after a calm dip advances; silence suppresses; switching to `random`
  restores `bpmSpeedSync`. (Uses a per-param source-lock to freeze the live
  mic analyzer out of the injected keys — see Known gaps.)
- **HIL — `hil_deck_playlist_slots_test.mjs` (27/27, engine 31068):** all E3
  wire surfaces (see contract confirmation below), incl. 409 EBUSY
  mid-transition and a full restart round-trip.
- **Auto-checks:** `npm run check` (syntax + dry-run) PASS; `node engine.js
  --list` PASS; `git diff --check` clean whitespace. Every commit passed
  `python scripts/security_check.py --staged` (and the pre-commit hook
  re-ran it). Never `--no-verify`, never pushed.

## E3 / E1 contract confirmation (per the CaptainPad audit — each item)

1. **`GET /deck/playlist/slots`** → `{ primary, secondary, splitRatio }` with
   each bound slot as the FULL `serializeDeckPlaylistSlot` object
   `{ name, activeEntryId, cursor, autopilot, live }`; a NON-live slot has
   `activeEntryId: null`; `splitRatio` a finite number; keys exactly
   `primary`/`secondary`/`splitRatio`. **MATCHES** (HIL TEST 1 + TEST 4).
2. **`deck` WS `playlistSlots`** folded into `serializeDeckState()` (same slot
   shape, no new WS type, connect-replay free). **MATCHES** — byte-identical
   to the GET (both call `serializeDeckPlaylistSlot`).
3. **`POST /deck/playlist/secondary`** `{name|null}`: `null` clears (no 400 on
   null); 200 `{status:'ok', playlist:<slot|null>}`; 404 unknown; 400
   `name===primary`; emits `channelPlaylistData{channelId:'secondary',
   playlist, playlistData}`; then `saveAllState()` + `broadcastDeckState()`;
   clear-while-live promotes. **MATCHES** (HIL TEST 2/3/6).
4. **`POST /deck/playlist/entry`** `{entryId, slot?}`: omitted = legacy; given
   resolves the slot name; 400 if the named slot is unbound; 409 `{error,
   code:'EBUSY'}` mid-transition. **MATCHES** (HIL TEST 4/4b).
5. **`POST /deck/playlist/split`** `{ratio}`: **INCLUSIVE** [0.15, 0.85] via
   `ratio < 0.15 || ratio > 0.85` (NOT `<=`/`>=`), so boundary values are
   accepted; fail-loud 400 otherwise. **MATCHES** (HIL TEST 5 — 0.15 & 0.85
   both 200; 0.1/0.9/NaN → 400).
6. **`POST /deck/playlist`** (pane-1) externally unchanged; adds internal
   `noteDeckLivePlaylist(name)` at both its branches (and both live-name choke
   points). **MATCHES**.
7. **`GET /autopilot` fix** — returns a NEW object `{ ...deckAutopilotState(),
   profile: normalizeAutopilotProfile(st.profile), profiles: AUTOPILOT_PROFILES
   }`, does NOT mutate the live/persisted `ap` ref. **MATCHES** (HIL TEST 3b
   asserts the persisted ref does not carry `profiles`).

**No deviations from the specified shapes.** (The one earlier un-flagged
deviation — `GET /autopilot` missing profile/profiles — is now fixed and
tested.)

## Deviations / decisions worth flagging (loud, not silent)

1. **`tools/port_cleanup.cjs` maxBuffer fix (out of the pure feature scope).**
   `netstat -ano` / `lsof` were called with no `maxBuffer`. On this machine
   (52,188 TCP entries, ~3.9 MB of `netstat` output) that overflowed the 1 MB
   default with `ENOBUFS`, making `freeStackPorts` fatal and crashing **every
   non-dry-run engine boot** — which blocked ALL HIL testing. I added a 64 MB
   `maxBuffer` to the two calls. It's a genuine, offline-safe reliability fix
   (a busy playa control box would hit the same), and it was a hard
   prerequisite for any HIL coverage. Flagging it explicitly since it lives in
   a shared tool, not `marsin_engine/`.
2. **`pickNextAutoCycleEntry` extracted to `lib/autopilot_pick.js`.** The
   profiles need the picker without a circular import on the giant
   `api_server.js`. I moved the picker + its clamps/constants there VERBATIM
   and `api_server.js` re-exports them, so every historical import path (unit
   tests, mixer/overlay ticks) resolves the identical symbols. No behaviour
   change (the seeded-RNG unit test proves it).
3. **Energy-arc speed drives `bpmSpeedMax` (the ceiling), not `speed`
   directly.** The operator asked the energy scale to "layer on bpmSpeedSync".
   Driving the ceiling makes the mapped speed sag/recover without the profile
   and bpmSpeedSync fighting over the `speed` key. Restored on detach.
4. **Colour is gated on a stable *descriptor* (energySlow band + regime +
   held note) held past `colorHoldMs` (6 s).** A raw `audioSwitchColor` pulse
   is only a *candidate* — it never recolours on its own. This is the
   operator's "colour drifts with mood, not beats" intent.

## Known gaps / follow-ups

- **HIL audio injection uses a per-param source-lock.** `test_bench` boots the
  live mic analyzer, which (correctly) parks `audioSilence=1` on an idle mic
  and would clobber injected gate values. The E2 HIL leases the injected keys
  to source `'api'` for the test's duration (released in `finally`). This is a
  test harness detail, not a product behaviour — the real path is the Companion
  writing those keys over OSC.
- **Predictive pre-arm (riser/dropCountdown/buildEta) is NOT wired.** The
  energy pickup is a reactive slope trigger (`audioDropPulse` confirms) — the
  brief explicitly allowed a small reactive delay for v1. Predictive pre-arm is
  a clean additive follow-up.
- **`config.yaml` autopilot-timing wart** (the daemon's `loadConfig/saveConfig`
  writing `playlist:` globally) is UNTOUCHED per the brief — it's a separable
  follow-up, and the profile design deliberately does not read/write
  `config.yaml`.
- **Genre-subset colour narrowing** (`audioGenre` gated on
  `audioGenreConf>0.5`) is scaffolded in the descriptor read but not yet used
  to filter the palette set — additive.

## Operator action requested

**Ready for review and merge** into `feat/autopilot_deck_improvement`. All
three phases land with green unit + HIL tests, clean auto-checks, and zero
tracked-state side effects. The frozen contracts (`profile`/`profiles` WS +
GET; the five E3 wire surfaces) match what CaptainPad (slot 1) was built
against. Flag for the instigator: the `.md` dossier shows as modified only
because my base predates the parent's `3a76b92` — my branch does not edit it,
so the merge takes the parent's newer version cleanly.
