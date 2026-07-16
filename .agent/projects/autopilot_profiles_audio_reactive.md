---
name: autopilot_profiles_audio_reactive
status: active        # active | paused | done
owner: coordinator (Opus multi-agent run)
created: 2026-07-06
updated: 2026-07-06
---

# Autopilot Profiles + Audio-Reactive Profile — DESIGN REFERENCE

> **This is a deep-design reference, not the execution plan.** The execution
> plan (slices, branches, gates, validation) lives in the master dossier
> [`autopilot_deck_improvement.md`](autopilot_deck_improvement.md). Everything
> here lands on the single deliverable branch **`feat/autopilot_deck_improvement`**
> (origin + local); worktree branches are local-only `dev/*` per
> `.agent/os/multi_agent.md`. Read this for the *what/why* of the autopilot half.

## Goal

Turn the deck autopilot from a single hard-coded behavior ("random") into a
set of named **profiles**, expose the active profile as a **dropdown in
CaptainPad** persisted in **per-scene** engine state, and add a new
**`audio_reactive`** profile that uses Audio Companion signals to drive pattern
selection, color, and slow/fast (tempo). The current random behavior becomes
the `random` profile — byte-for-byte unchanged. Advances the operator vision in
`docs/40_autopilot_improvements.md:117-121`.

Grounded in two read-only Fable analyses (2026-07-06); every claim carries a
`file_path:line` citation. Agents MUST still open the cited code before editing.

## Audio signals that exist and are usable (CPC keys)

Single source of truth: `marsin_engine/audio/postproc/audio_signals.js:1-72`.
Produced by the Audio Companion (`marsin_engine/audio/companion/`), streamed
over UDP OSC to the engine `:10000`, mapped to CPC keys in
`marsin_engine/lib/osc_listener.js:1-46`. Engine's own analysis is OFF
(`config.yaml:32`); the Companion is the sole analyzer.

| Purpose | CPC key | Notes / cite |
|---|---|---|
| Pattern-change moment | `audioSwitchPattern` (0/1 pulse) | drop/energy-regime/slow-zone, beat-quantized, min-dwell 6 s — `audio/signals/switch_signals.js:1-61,69-90` |
| Color-change moment | `audioSwitchColor` (0/1 pulse) | note-change/drop/structure, min-dwell 2.5 s — `switch_signals.js:26-36` |
| Palette choice | `audioNoteHue` [0,1] | dominant pitch class ÷ 12, held during silence — `audio/signals/derived_signals.js:225-233` |
| Palette subset | `audioGenre` 0–6 + `audioGenreConf` [0,1] | `audio_signals.js:113-140` |
| Tempo→speed | `audioBpm` [0,300] | via existing `bpmSpeedSync` — `lib/bpm_speed_sync.js:1-45` |
| Pick bias / cadence | `audioEnergyRatio`, `audioSlowZone` [0,1] | loud→jumpy, slow→dwell — `switch_signals.js:47-48` |
| Punchy transitions | `audioRiserScore`, `audioDropCountdown` | pre-arm short/long deck transition |
| Hold-still gate | `audioSilence`, `audioParty` | suppress advances when silent / not party |

**Consumption mechanism** already exists: subscribe to the CPC via
`paramCenter.subscribe` exactly like `BpmSpeedSync` (`bpm_speed_sync.js:75-80`).

**Known caveats (do not skip):**
- **Structure detector is "disabled by default, under development"**
  (`audio/README.md:22`) and it feeds `audioSwitchPattern`. Config the profile
  to also weight beat/phrase triggers (`audioDownbeat`, `audioPhraseBoundary`).
- **`audioSwitchPattern/Color` are one-hop pulses** but the Companion throttles
  OSC sends (`companion_server.js:145-171`) → a pulse can be dropped. **Spike 0
  (below) must verify this before the audio-reactive picker is built.**
- **No spectral centroid exists**; `micChromaTiltRaw` is engine-internal only,
  no OSC inbound (`audio_signals.js:166-170`). Palette *temperature* mapping is
  out of v1 unless a registry entry + Companion emit is added — call it out.
- **Playlist entries carry no energy/mood metadata** (`lib/playlist_manager.js`).
  The profile biases *selection strategy* (shuffle vs group-locality), not
  semantic energy matching. A per-entry `energy` field is a future task.

## Autopilot as it exists

- **The seam already exists**: `Autopilot` is a pure timing host; selection is
  an injected callback. Host `marsin_engine/lib/autopilot.js:10-169`
  (self-rescheduling `setTimeout`, generation counter, `nextSwapAtMs`). Callback
  wired `lib/api_server.js:3291-3348` — loads the deck playlist, picks the next
  entry, swaps via `loadPlaylistEntryWithTransition` (awaits crossfade; `EBUSY`
  skip `:3334-3339`).
- **"random" logic** = pure picker `pickNextAutoCycleEntry`
  (`lib/api_server.js:408-467`): group-locality → shuffle (uniform random
  excluding current, `:455-458`) → sequential. Randomizes only *which entry*;
  timing is fixed `delay_s`; never touches color/speed/brightness.
- **ColorAutopilot** = parallel palette daemon (`lib/color_autopilot.js:21-61`);
  `triggerNext()` at `:431-433`.

## Persistence (CORRECTED — the important design decision)

Requirement: the selected profile persists as **per-scene** engine state, NOT
in global `config.yaml`.

**Decision: the profile lives on the deck channel's `playlist.autopilot` object
— `baseCh.playlist.autopilot.profile` — with ZERO new persistence plumbing.**

Why this is the right home (Fable-2 finding):
- It is a *pick-behavior* field exactly like `shuffle`/`groupMode`, which
  already live on `playlist.autopilot` (`lib/pattern_channel.js:204-207`) and
  already round-trip **per-scene** via `serializeChannel` (writes
  `playlist: ch.playlist` verbatim, `lib/state_manager.js:29`) → `saveDeckState`
  → `states/<model>/deck_state.yaml`, restored verbatim by `buildChannelFromSaved`
  (`api_server.js:2084`). The existing save/restore sites carry the new field
  for free.
- A separate deck-state *extra* (like `transitionConfig`) would be the wrong
  altitude and would need its own save/restore/WS plumbing.
- The daemon (`Autopilot`) needs **no** persistence change — it stays a pure
  timing host; the profile is consulted inside the injected selection callback
  (`api_server.js:3298-3344`), which already reads `baseCh.playlist.autopilot`
  live (`:3314-3315`).

**Pre-existing wart (fix as a SEPARATE commit / follow-up, do not bury here):**
autopilot *timing* state (`active/delay_s/shuffle`) is ALSO written to global
`config.yaml` under `playlist:` by `Autopilot.loadConfig/saveConfig`
(`autopilot.js:8,57-98`) with empty-catch error swallowing (`:69-82`, violates
codex fail-loud). So after a model switch, config.yaml's `active` (last scene)
drives the boot timer while the restored channel block (this scene) drives the
UI — two sources of truth that can disagree. The clean fix: seed the daemon at
boot from the restored channel block (`autopilot.updateState({active,delay_s,
shuffle})` right after deck restore, before `autopilot.start()` at
`api_server.js:7884`) and delete `loadConfig/saveConfig`. **This is separable
from the profile work — its own commit, not silent.** The profile design does
NOT read or write `config.yaml`.

## Profile abstraction (frozen contract)

Two Fable reports converged on this once reconciled:

- The persisted/wire representation is a **string** `profile` on
  `playlist.autopilot` (default `'random'` when absent — the ONE documented
  schema default, mirroring the `autoGroupFields` normalizer at
  `api_server.js:385-390`). A *present-but-unknown* value is a loud error, never
  silently coerced.
- The runtime dispatch is a **registry** mapping name → behavior. Because the
  `audio_reactive` profile is **event-driven** (it advances on audio pulses, not
  a fixed timer), the behavior is a small profile object, not just a picker fn:

```
name                       // 'random' | 'audio_reactive'
attach(ctx)                // ctx = { paramCenter, requestAdvance(), state() }
detach()                   // unsubscribe, restore any CPC globals it set
nextDelayMs(state)         // number → arm timer;  null → event-driven, no timer
pickNextEntry(pl, ap, curEntryId, groupRuntime)  // entry | null
validateState(wire)        // throw on invalid profile-specific fields
```

- `ctx.requestAdvance()` runs the existing `_runTick(this.generation)` path so
  generation guards, await-swap, and broadcast all still apply; a call during an
  in-flight swap is a no-op via the existing `EBUSY` skip (`api_server.js:3334-3339`).
- `random` profile: `nextDelayMs = delay_s*1000`, `pickNextEntry =
  pickNextAutoCycleEntry` (`api_server.js:408-467`) — **byte-identical to today**.

New engine files (snake_case, imports at top, fail-loud):
```
marsin_engine/lib/autopilot_profiles/profile_registry.js   // {random, audio_reactive}; lookup miss throws
marsin_engine/lib/autopilot_profiles/random_profile.js     // ~20-line adapter over the existing picker
marsin_engine/lib/autopilot_profiles/audio_reactive_profile.js
```
Also export the profile-name list + default (`AUTOPILOT_PROFILES`,
`AUTOPILOT_PROFILE_DEFAULT`) and a `normalizeAutopilotProfile()` for the
routes/broadcast to share.

### REST / WS / restore

- `deckAutopilotState()` (`api_server.js:2961-2965`) + `broadcastAutopilot()`
  (`:2966-2978`) **and the WS on-connect replay** (`:7907-7918`, hand-builds the
  same payload — must also carry the new fields or late joiners see a stale
  dropdown; better: refactor both to one builder) gain `profile` (normalized) +
  `profiles: AUTOPILOT_PROFILES`.
- `POST /deck/playlist/autopilot` (`:7528-7560`) accepts `profile`; unknown →
  **400, loud** (clone the `trans_` validation posture at `:7574-7579`); on
  change reset the group window like the group fields (`:7549-7551`); ends with
  existing `saveAllState()` + `broadcastAutopilot()`. Mirror into `POST
  /autopilot` (`:4797`) only if radio parity is wanted (open question).
- Selection callback (`:3298-3344`) dispatches on profile via the registry and
  **throws on unknown** (daemon's catch warns, `autopilot.js:148-150`).
- Restore validation (deck path of `buildChannelFromSaved`, after `:2084`): a
  present-but-unknown `profile` → `console.warn` + clear to `'random'` (clone
  the dangling-`activeEntryId` precedent at `:2102-2108`). Absent → leave absent;
  readers apply the documented default via the normalizer.
- Timeline cue `autopilot` block (`show_plan.js:172-230`) MAY gain an optional
  `profile` slug so a cue arms a profile (open question); `timelineSetAutopilotOnDeck`
  (`api_server.js:3480-3509`) mirrors it. If done, the Cue editor's reuse of the
  autopilot panel gets the dropdown for free.

## Profile dropdown UI (CaptainPad)

**Component: clone the `TransitionStylePicker` idiom** — the deck's only true
dropdown: tap-to-open `<Modal transparent>` list with label+hint rows,
current-item highlight, `▾` trigger (`CaptainPad/components/DeckTransitionControls.tsx:221-320`).
NOT `LibraryModal` (too heavy), NOT `ToggleButton` (boolean), NOT native
`<Picker>` (retired on this deck, `index.tsx:952-957`).

- New file (snake_case): **`CaptainPad/components/deck/autopilot_profile_picker.tsx`**
  — presentational `{ profile, profiles, onSelect, disabled }`. Option metadata
  local: `random → {label:'RANDOM', hint:'Shuffle/sequential cycling (today)'}`,
  `audio_reactive → {label:'AUDIO REACTIVE', hint:'Pick driven by live audio'}`;
  an unknown id renders as its raw uppercased id (deterministic, not a fallback).
  Trigger `minHeight:44` (deck touch floor, `index.tsx:42-44`). `usePalette()`
  tokens ONLY — the cloned source uses literal `rgba(95,35,199,…)` washes
  (`DeckTransitionControls.tsx:250,295`); take those from `C.*` per
  `.agent/os/ui_design.md:113-118`, don't copy hex.
- **Placement:** inside `PatternAutopilotPanel`
  (`CaptainPad/components/deck/pattern_autopilot_panel.tsx`), a new `PROFILE`
  row directly under the header (between `:123-166` and `AutopilotTimerPills`
  `:169-175`). Panel stays pure/controlled: add props `profile`, `profiles`, and
  a `profile?` key on `PatternAutopilotPatch` (`:42-49`). Inherits the card's
  planGate dim for free (`:113-118`); works unchanged when the Cue editor reuses
  the panel.
- **Wiring in `app/(tabs)/index.tsx`:** state `autopilotProfile` (default
  `'random'`) + `autopilotProfiles` (default `['random']`) beside existing
  autopilot state (`:197-210`); seed from `getAutopilot()` in `seed`
  (`:428-434`); reconcile in the `autopilot` WS branch (`:350-360`); new
  `utils/api.ts` `setAutopilotProfile(profile)` → `POST /deck/playlist/autopilot
  {profile}` next to `setAutopilot` (`utils/api.ts:619-664`); handler cloned
  from `handleDeckTxChange` (`:482-514`) — `notifyInteraction()` → snapshot →
  optimistic set → POST → rollback + `Alert` on `!ok` (Codex P0: never show a
  value the engine refused). planGate guarded three ways (panel `disabled`,
  `PlanLockScrim`, and a `if (planGate) return;` in the handler).

## Spike 0 (REQUIRED before the audio-reactive picker is built)

Empirically determine whether `audioSwitchPattern`/`audioSwitchColor` pulses
survive the Companion OSC throttle (`companion_server.js:145-171`). Inspect the
fire-flag hold-width in `switch_signals.js:69-90`; if single-hop, the profile
triggers on "`audioSwitchPattern > 0` seen within a ~200 ms window" rather than
a strict rising edge. Record the finding in the engine slice report. Do **not**
widen the source pulse without operator sign-off (changes behavior for every
consumer).

## Audio-reactive profile behavior (design)

**Guiding principle (operator, 2026-07-06): PATTERN reacts to DYNAMICS (fast —
energy transients), COLOR reacts to STABLE STATE (slow — sustained changes).**
The two are deliberately driven by different time-scales of the same energy
signal so they don't fire together.

Using only signals proven to exist:
- **Pattern advance:** `nextDelayMs` → `null`; subscribe `audioSwitchPattern`,
  `ctx.requestAdvance()` on trigger (edge or 200 ms window per Spike 0).
  Profile-side `minIntervalMs` re-guard (default 6000) + explicit `maxDwellS`
  safety advance (default 300). Suppress when `audioSilence==1`/`audioParty<0.5`.
- **Pick bias:** `audioEnergyRatio>0.6` → shuffle; `audioSlowZone>0.55` →
  group-locality.
- **Speed:** set CPC `bpmSpeedSync=1` + `bpmSpeedMin/Max` on `attach`, restore
  on `detach` (read-modify-restore, no fallback). See energy-arc below for the
  slow-down behavior layered on top.
- **Transition punch:** high `audioRiserScore`/`audioDropCountdown` → short deck
  transition; slow zone → long crossfade (`setDeckTransition`, `:469-474`).
- **Brightness:** none unless operator gate flips.

### Energy-arc dynamics — slow-down + switch (operator request, 2026-07-06)

The profile keeps a **smoothed energy envelope**: `energyFast` = EMA of
`audioEnergyRatio` (τ ≈ 2 s) and `energySlow` = a longer EMA (τ ≈ 8–12 s), plus
`audioSlowZone` as a corroborating regime signal. On each frame it compares them.

- **Stable high→low energy shift ⇒ SLOW THE PATTERN DOWN.** When `energyFast`
  is in a *sustained* decline (`energyFast < energySlow` held for ≥ ~4 s, and/or
  `audioSlowZone` rising), continuously ramp the pattern speed **downward** — a
  smooth map from the smoothed energy to a speed multiplier / the `speed` CPC
  (lower energy → slower), never stepwise. This layers on the BPM speed sync:
  the profile drives an energy-derived speed *scale* that sags as the music
  calms. Ramp back up only as energy stably recovers (hysteresis, no jitter).
- **Sudden energy PICKUP ⇒ PATTERN SWITCH.** On a fast *positive* jump in
  `energyFast` (rising slope over a threshold within ~1 s, i.e. the low→high
  transition after a calm stretch) → `ctx.requestAdvance()` (still honoring
  `minIntervalMs`). **Predictive is preferred but optional:** pre-arm the switch
  slightly ahead using `audioRiserScore` / `audioDropCountdown` / `audioBuildEta`
  so the change lands *on* the pickup; a **small reactive delay** after the
  pickup is explicitly acceptable per the operator, so a non-predictive
  slope-trigger is a valid v1. `audioDropPulse` is the strongest confirmation.
- This composes with the existing `audioSwitchPattern` trigger — treat the
  energy-pickup as an *additional* advance source OR'd into the same
  `requestAdvance()` path (both go through `minIntervalMs`), so drops and
  energy-pickups both switch patterns without double-firing.

### Color on STABLE audio changes (operator request, 2026-07-06)

Color must change on **settled** shifts in the audio situation, NOT on the
transients that drive pattern. The profile tracks a coarse **situation
descriptor** — quantized energy band (from `energySlow`) + section/regime
(`audioSlowZone` / `audioStructure` when trustworthy) + held note class
(`audioNote`) — and only triggers a color change when that descriptor **changes
and then holds** for a dwell (≈ 4–8 s, hysteresis + hold). On such a stable
change, map the settled `audioNoteHue` → nearest curated palette by `c1` hue
distance over `engineCore.colorPalettes` (`api_server.js:3356-3364`), applied
via `timelineSetColorAutopilot` (`:3448-3460`) or `colorAutopilot.triggerNext()`;
optional `audioGenre` subset gated on `audioGenreConf>0.5`. Use `audioSwitchColor`
only as a *candidate* moment that still must pass the stable-hold gate — a
raw drop/onset alone must NOT recolor. Net effect: colors drift with the
song's mood, not its beats.

## Open questions (feed the master's gate list)

1. May `audio_reactive` touch the deck grand master (brightness)? (default: no)
2. Default `maxDwellS` + silence behavior? (default: 300; hold on silence)
3. Auto-arm `audio_reactive` on the party mood cue `c_mood_to_party`
   (`playa_default.yaml:123-145`)? (default: wire but flag off)
4. Should the mixer/deck-overlay auto-cycles (share `pickNextAutoCycleEntry`,
   `api_server.js:3288-3290`) eventually honor a profile too? (v1: deck only)
5. Radio parity — should `POST /autopilot` (`:4797`, PortWatch/LoRa) accept
   `profile`? (grows LoRa payload)
6. Behavior on profile switch mid-cycle: reset group window + let countdown
   finish (recommended) vs reschedule immediately?
7. Approve the separable `config.yaml`→per-scene daemon-seed retirement?
8. Confirm dropdown labels/hints wording.

## Decisions log

- **2026-07-06** — Profile = injected (when-to-advance, what-to-do) over the
  existing pure timing host + injected selection callback.
- **2026-07-06** — Profile persists as a string on `playlist.autopilot`, which
  already round-trips per-scene via `serializeChannel` → `deck_state.yaml` (zero
  new plumbing). NOT config.yaml, NOT a separate extra.
- **2026-07-06** — The global-config timing wart is a *separable* follow-up, not
  folded into this feature.
- **2026-07-06** — Dropdown clones `TransitionStylePicker`, placed in
  `PatternAutopilotPanel`.
- **2026-07-06** — v1 excludes spectral-centroid palette temperature and
  per-entry energy matching (neither exists) — additive follow-ups.
- **2026-07-06 (operator add)** — Energy-arc: stable high→low energy ramps
  pattern speed DOWN; sudden low→high pickup triggers a pattern SWITCH
  (predictive nice, small reactive delay OK). COLOR is gated to *stable/settled*
  audio changes (dwell-held situation descriptor), never on the transients that
  drive pattern. Pattern = dynamics/fast, color = stable-state/slow.
