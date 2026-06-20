# Design 39: Channels — Deck, Mixer, and Hot-Swap Playlists

**Status**: Reference (as-built, 2026-06-20)
**Scope**: BM26-Titanic `marsin_engine` + `CaptainPad` channels subsystem
**Goal**: Single source of truth for how the **deck** and the **mixer** work after
the channels-improvement campaign — hot-swap playlists, production/operational
signals, and the two-view (deck/mixer) CaptainPad surface.

This doc is the as-built reference. It extends three existing design docs and
does **not** duplicate them:

| See also | For |
|---|---|
| `docs/18_marsin_mixer.md` | Original mixer architecture, blend modes, parameter scopes |
| `docs/19_playlists.md` | Playlist file format, assignment state, autopilot, capture |
| `docs/27_mixer_layer_view_selection.md` | `viewFader` crossfade math, per-channel view masks |

Every endpoint and field below was verified against the code; implementation
sites are tabulated in §6.

---

## 1. Concepts

### 1.1 Deck vs Mixer

The engine maintains **two output buffers** and crossfades between them:

| | **Deck** | **Mixer** |
|---|---|---|
| What it is | Singleton PFL (pre-fade-listen) preview channel | Stack of live overlay channels |
| How many channels | Exactly one (`deckChannel`) | 0..N overlays (`maxChannels = 6`) |
| Renders into | `deckBuffer` (the focused pattern at 100%) | `mixerBuffer` (composited) |
| Composite | None — single pattern | Bottom→top: base seeds the buffer, overlays blend on top with each channel's fader + blend mode |
| Pattern switch | **Soft swap** — ping-pong double-buffer crossfade | **Instant** load (no double-buffer) |

The deck is a *preview/cue* surface and a single live channel; the mixer is the
*layered show*. The deck channel (`baseChannelId`) is intentionally excluded
from the mixer composite loop — see `docs/27` for the per-layer compositing.

### 1.2 Channel and Playlist

A **channel** owns one WASM pattern handle plus its operator-visible state
(id, name, fader, blend mode, view selection, local controls, lock flags). A
**playlist** is an ordered list of entries assigned to a channel (deck or
mixer overlay); each channel has its own independent assignment + cursor +
autopilot. See `docs/19_playlists.md` for the full data model.

### 1.3 View crossfade (`viewFader`)

Final output is a linear crossfade between the two buffers:

```
outputBuffer[i] = deckBuffer[i] * (1 - viewFader) + mixerBuffer[i] * viewFader
```

- `viewFader = 0.0` → output is the deck (PFL).
- `viewFader = 1.0` → output is the mixer composite (the startup default).
- The CaptainPad deck/mixer tabs select the view via `POST /mixer/view`
  `{ view: 'deck' | 'mixer' }`, which ramps `targetViewFader` to 0.0 / 1.0.
- After the crossfade, the master fader scales the output, then global
  effects + intensity run (unchanged from `docs/18`).

The crossfade math and its linearity guarantees are owned by
`docs/27_mixer_layer_view_selection.md` — do not re-derive it here.

### 1.4 View-override lease

`POST /mixer/view-override { override: 'deck' | null }` **pins** the output to
the deck side regardless of any `/mixer/view` writes that arrive while engaged
(e.g. a podium or controller forcing a cue). It is **leased**: a client holding
the pin re-POSTs periodically to renew a ~30s lease; clearing it
(`override: null`) snaps `targetViewFader` back to the value saved when the pin
was taken. This is distinct from `/mixer/view` (the normal tab toggle).

### 1.5 Auto-finalize on tab-away

Navigating to the mixer tab (`POST /mixer/view { view: 'mixer' }`) while a deck
soft-swap is mid-fade calls `finishDeckSwapNow()` — the swap snaps to its end
(atomic handle swap + `onComplete`) so returning to the deck shows the
destination pattern fully, not a half-blended buffer.

---

## 2. Hot-swap playlists (flagship)

"Hot-swap" loads a **different** playlist onto a channel and lands on its first
(or a specified) entry, additively and behind explicit `/swap` routes — the
existing entry-advance routes (`/deck/playlist/entry`,
`/mixer/channels/:id/playlist/entry`) are untouched.

The **deck swap is a soft swap** (rides the ping-pong double-buffer crossfade
via `loadPlaylistEntryWithTransition`). The **mixer swap is instant** (overlays
have no double-buffer machinery — it is a plain `loadPlaylistEntry`).

### 2.1 API surface

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/deck/playlist/swap` | `{ name, entryId?, transition? }` | Soft crossfade onto another playlist. Parametric per-call transition override. |
| `POST` | `/deck/playlist/queue` | `{ name, entryId? }` | Warm-then-fire: compile + park in inactive slot WITHOUT advancing. |
| `POST` | `/mixer/channels/:id/playlist/swap` | `{ name, entryId? }` | **Instant** overlay load of another playlist. No `transition`. |
| `POST` | `/deck/playlist/entry` | `{ entryId }` | (Existing) advance within the loaded deck playlist (soft swap). |
| `POST` | `/mixer/channels/:id/playlist/entry` | `{ entryId }` | (Existing) instant overlay entry advance. |

`entryId` is optional on the swap routes: omitted ⇒ the first non-`_missing`
entry of the target playlist.

### 2.2 `POST /deck/playlist/swap` — request/response

Request body:

```json
{
  "name": "chill_night",
  "entryId": "e_1715120000003",
  "transition": { "enabled": true, "mode": "trans_crossfade", "durationMs": 1200 }
}
```

- `name` (required string) — playlist to swap to.
- `entryId` (optional) — entry to land on; defaults to first usable entry.
- `transition` (optional) — **per-call override** of the global
  `deckTransitionConfig` FOR THIS SWAP ONLY. Validated identically to
  `POST /deck/transition-config` (see §2.4). It does **not** mutate the global;
  omitting it gives existing callers the exact current behavior.

Success (`200`):

```json
{
  "status": "ok",
  "playlist": { "name": "chill_night", "activeEntryId": "...", "cursor": 0, "autopilot": {...} },
  "pattern": "08_ocean_liner",
  "transitionId": 42,
  "targetEntryId": "e_1715120000003"
}
```

> **`targetEntryId` is load-bearing (FIX B).** During a deck soft-swap,
> `playlist.activeEntryId` is still the **OLD** entry — the new id is only
> written in the swap's `onComplete` after the fade. The client must arm its
> pending-gate from the response's `targetEntryId`, NOT from
> `playlist.activeEntryId`, or the UI pins to the stale entry until the ~8s
> watchdog fires. The mixer entry/swap routes settle synchronously, so they
> return `pattern`/`playlist` already reflecting the new entry.

### 2.3 Error codes

| Status | Cause |
|---|---|
| `400` | `name` missing/empty; invalid `transition` field; explicit `entryId` is `_missing` (pattern not on disk); playlist has no usable entries; malformed playlist YAML (`PlaylistLoadError`, body carries `code`). |
| `404` | No deck channel; playlist file not found; explicit `entryId` not found in the target playlist. |
| `409` | `code: "EBUSY"` — a deck swap is already in flight. The route returns 409 rather than force-finishing the prior swap, because force-finishing would visibly snap the deck to an intermediate pattern the operator didn't choose to settle on. The caller (e.g. a timeline driver) decides whether to retry on the next anchor. |

The mixer swap route returns the same `400`/`404` for the same reasons but has
no in-flight concept (instant load), so no `409`/`EBUSY` on the swap path
itself.

### 2.4 Parametric transition validation

`validateSwapTransitionOverride(override, base)` (api_server.js) mirrors
`POST /deck/transition-config` field-for-field so the two paths cannot drift:

- `enabled` — optional boolean.
- `shuffle` — optional boolean.
- `mode` — optional string, must start with `trans_` (a scripted transition,
  not a steady channel blend).
- `durationMs` — optional, must be **finite** (non-finite ⇒ 400), then clamped
  to `[DECK_TRANSITION_MIN_MS, DECK_TRANSITION_MAX_MS]` = `[50, 30000]` ms.

A bad override 400s **before** the deck is touched — no silent fall-through to
the global config (Codex P0).

### 2.5 `POST /deck/playlist/queue` — warm-then-fire

Compiles a target entry's pattern and **parks** it in the inactive deck slot
WITHOUT advancing the deck. The next swap (manual ping-pong or autopilot) that
targets the same pattern reuses this warm handle for a **zero-compile** fade —
letting a timeline pre-stage the next look on a musical anchor and fire it
instantly when the beat lands.

- Uses the leak-safe `mixer.warmInactiveDeckHandle(patternName, handle)`
  contract: a redundant handle (slot already holds this pattern) or a refused
  handle (swap raced in) is **destroyed by the mixer**, never leaked. Handle
  ownership transfers to the mixer on the call.
- Returns `200 { status, warmed, entryId, reused }` (`reused: true` when the
  slot already held this pattern — no recompile).
- Returns `409 { code: "EBUSY" }` if a swap is in flight (the inactive slot is
  the live fade target then).
- Returns `400` on `name` missing, compile error, or `_missing` entry.

---

## 3. Production / operational signals

All of these are Codex-P0 "fail loud, never silent" surfaces. A green rig is
`renderHealth.ok === true` with empty `blendErrors` and `deckRestoreDegraded === null`.

### 3.1 `GET /status.renderHealth`

```json
"renderHealth": { "ok": true, "frame": 11, "blendErrors": [] }
```

- Blend handles are **precompiled at boot**, triggered by the
  `mixer.patternsDir` setter (boot wiring lives in `pattern_mixer.js`, not
  `engine.js`). This removes lazy compile from the 40 Hz hot path.
- If a blend script is missing or fails to compile, the mixer composites that
  mode via a **host-side linear-interpolation fallback** (so the rig never
  freezes), records the error in `renderHealth.blendErrors`, and logs it
  **loudly ONCE per mode** (not per frame). `ok` flips to `false` and
  `blendErrors[]` names the offending mode (`{ blend, message, sinceFrame, count }`).
- The error is cleared the moment that mode's handle compiles successfully
  (e.g. a boot precompile or a hot edit). This is the *visibility* contract:
  the fallback exists so the rig stays lit, but it must never be silent.

### 3.2 `GET /status.deckRestoreDegraded`

```json
"deckRestoreDegraded": { "failedPattern": "29_bar_dancers", "reason": "...", "fellBackTo": "test_const" }
```

`null` on a clean boot. Non-null iff the saved **deck** channel failed to
restore.

> **The deck NEVER dark-starts (FIX A, mission-critical).** The deck drives the
> Titanic exterior — the one surface that must be visible at night.
> `restoreDeckWithFallback(saved, defaultPattern, build)` tries to build from
> the saved pattern; on ANY failure (saved pattern null/empty/missing-on-disk,
> or compiles-but-fails) it **falls back to the default pattern** so the deck is
> never dark, preserving the saved channel's identity/lock/view prefs. The
> fallback is loud (`console.error`) and visible (`deckRestoreDegraded` on
> `/status`). It throws fatally **only** if the default pattern ALSO fails —
> that means the install itself is broken. (Mixer overlays degrade
> independently: a dead overlay warns and is skipped; the deck + other overlays
> stay live.)

A dangling `activeEntryId` (the entry was deleted from the playlist since the
state was saved) is detected at restore, WARNed loudly, and **cleared** so the
channel is in a clean "no active entry" state rather than carrying a ghost
pointer.

### 3.3 Fader validation

`validateFader(raw)` (api_server.js) guards every fader write path (master,
deck, mixer overlays, and WS fader messages):

- Accepts only an actual `number`, or a non-empty string that parses to a
  finite number. Rejects `null`/`undefined`/boolean/object outright — JSON
  coercion (`Number(null)===0`, `Number(true)===1`) would otherwise mask a
  structurally-wrong payload as a valid fader (silent fallback, Codex P0).
- Non-finite ⇒ rejected (and a WS write replies `channelFaderRejected`).
- A valid value is **clamped to `[0, 1]`**.

### 3.4 Atomic state writes

State persistence (`state_manager.js`) writes via temp-file + `fsync` + rename
so a crash mid-write can never leave a torn/partial state file on disk. Channel
serialization is de-duplicated through a shared `serializeChannel()` helper
(byte-compatible on disk; backward-compatible — no export removed). See
`docs/19_playlists.md` §3 for the on-disk schema.

---

## 4. The two views in CaptainPad (deck + mixer)

Both screens drive the engine over WebSocket and share one connection
lifecycle. Patterns below were verified in `useEngineConnection.ts`,
`PlaylistPanel.tsx`, `utils/api.ts`.

### 4.1 WS-driven (no polling)

`useEngineConnection` owns the boot + subscription lifecycle for both the deck
(`index.tsx`) and mixer (`mixer.tsx`) screens: resolve API base → probe
connection (drives the CONNECTED/OFFLINE pill) → nudge the singleton WS buses
to reconnect **only if down** (a forced reconnect on every tab focus tears a
live socket apart and flashes "Engine Offline") → seed view-specific REST
state → subscribe to control/status/viz buses → re-run on AppState `active`.
Each screen supplies its own REST seed + per-bus handlers; the hook is a refactor,
not a behavior change. Connection failures surface through `onStatus` — the hook
neither swallows errors nor substitutes default state (Codex P0).

### 4.2 Optimistic-update + reconcile + pending-gate

- **Fader/param moves** can update locally optimistically (low-latency over WS),
  with the WS broadcast reconciling the canonical state.
- **Hot-swap does NOT optimistically flip local state**: the deck transition
  takes ~Ns and the engine keeps reporting the prior entry until it completes.
  The panel arms a **pending-gate** from the response's `targetEntryId`
  (§2.2) and lets the WS broadcast (`deck` / `mixer` / `channelPlaylistData`)
  reconcile the final entry — so the row highlight settles on the swapped-in
  entry without bouncing. A watchdog (~8s) clears the gate if no broadcast
  arrives.
- A `swapEpochRef` ticks on each tap so a stale POST response can't be applied
  on top of a newer swap (last-write-wins guard).

### 4.3 Fail-loud error surfacing

Hot-swap and entry-tap surface real failures via `Alert` (Codex P0 — no silent
swallow). The single deliberate exception is `409/EBUSY` (a swap already in
flight): swallowed silently, because the operator double-tapping / tapping
mid-crossfade is expected, not an error. API clients honor `res.ok` (a non-2xx
is `{ ok: false, error }`, never a fake `{ ok: true }`).

### 4.4 Destructive actions, viz isolation, touch targets

- **ConfirmSheet** gates destructive actions (channel delete, playlist-entry
  removal) — no silent destructive taps. Its buttons carry `hitSlop`.
- **ChannelVizStrip** self-subscribes to viz frames so a viz update no longer
  reconciles the whole strip list (`React.memo` holds) — kills the re-render
  storm.
- Touch targets are **≥44 pt** (hitSlop) on icon buttons and rows.

### 4.5 Mixer SWAP copy is honest (FIX B)

The mixer-overlay SWAP confirm/help copy says **"Switch … instantly (no
crossfade)"**, not "Crossfade" — because a mixer swap is an instant load. Only
the deck swap copy says "Crossfade". The copy branches on `role` in
`PlaylistPanel.tsx`.

### 4.6 Do / Don't for contributors

**Do**
- Route all engine I/O for these screens through `useEngineConnection` +
  the `utils/api.ts` clients; honor `res.ok` and surface errors via `Alert`.
- Arm the pending-gate from `targetEntryId` on deck swaps.
- Add new touch targets at ≥44 pt; gate destructive actions with `ConfirmSheet`.
- Let WS broadcasts reconcile final state; keep optimistic UI to fader/param moves.

**Don't**
- Poll the engine on an interval — the buses are push.
- Force a WS reconnect on every focus (tears live sockets).
- Optimistically flip the active entry on a deck swap (it's still the old entry
  until `onComplete`).
- Swallow non-`EBUSY` failures, or fabricate `{ ok: true }` on a non-2xx.
- Read the deck channel out of the `/mixer` broadcast (it is excluded by
  invariant; `hil_channel_isolation_test.mjs` enforces this).

---

## 5. Timeline-readiness (follow-up, NOT done here)

The parametric `POST /deck/playlist/swap` (per-call `transition` override,
concurrency-safe with 409/EBUSY) and the warm-then-fire `POST /deck/playlist/queue`
endpoints were added **so that** `feat/timeline_support`'s arbiter can drive
smooth, anchored, cut-or-fade deck changes: queue the next look on an anchor,
fire it with an exact `durationMs`/`mode` on the beat, and get a clean `EBUSY`
to retry on the next anchor if a swap is still settling.

**The timeline integration itself is follow-up work on `feat/timeline_support`,
not this branch.** Specifically still open there:

- Wiring the timeline arbiter to call `/deck/playlist/swap` + `/deck/playlist/queue`
  instead of the instant `loadPlaylistEntry` hard-cut it uses today.
- Reconciling the timeline's **per-channel `autopilotPool`** against this
  branch's **single global deck autopilot** — they collide on merge and the
  resolution is a merge-time design decision for whoever integrates the timeline.

This doc documents the endpoints; it does not claim the timeline uses them.

---

## 6. Implementation map

Engine (`marsin_engine/lib/`):

| Site | What |
|---|---|
| `api_server.js` `validateFader` (~195) | Fader non-finite reject + `[0,1]` clamp |
| `api_server.js` `validateSwapTransitionOverride` (~238), `DECK_TRANSITION_MIN/MAX_MS` (~218) | Per-call transition override validation + duration bounds |
| `api_server.js` `restoreDeckWithFallback` / `buildDeckFallback` (~372) | Deck never dark-starts |
| `api_server.js` `loadPlaylistEntryWithTransition` (~1278) | Deck soft-swap helper (used by swap + entry) |
| `api_server.js` `/status` renderHealth + deckRestoreDegraded (~2274/2281) | Operational signals |
| `api_server.js` `/deck/playlist/swap` (~4104), `/deck/playlist/queue` (~4199) | Deck hot-swap + warm |
| `api_server.js` `/deck/transition-config` (~4322) | Global deck transition config |
| `api_server.js` `/mixer/channels/:id/playlist/swap` (~4447), `/entry` (~4415) | Mixer instant swap/advance |
| `api_server.js` `/mixer/view` (~3240), `/mixer/view-override` (~3260) | View crossfade + leased pin |
| `pattern_mixer.js` `getRenderHealth` (~371), `precompileAllBlends`/`precompileBlend` (~389), `_recordBlendError` (~424) | Boot blend precompile + render health |
| `pattern_mixer.js` swap state machine: `warmInactiveDeckHandle` (~960), `getInactiveDeckPattern` (~1009), `isDeckSwapInFlight` (~1217), `finishDeckSwapNow` (~1234), `cancelDeckPatternSwap` (~1200), `updateDeckSwapTransition` (~1247) | Ping-pong double-buffer deck swap |

CaptainPad:

| Site | What |
|---|---|
| `hooks/useEngineConnection.ts` | Shared WS boot/subscribe lifecycle |
| `utils/api.ts` `swapDeckPlaylist` (~1421), `swapMixerChannelPlaylist` (~1451), `swapChannelPlaylist` (~1482) | Typed swap clients (EBUSY on 409, cache-invalidating) |
| `components/PlaylistPanel.tsx` `handleHotSwap` (~708), swap picker + ConfirmSheet (~1468) | SWAP UI, pending-gate, honest mixer copy |

Tests / HIL (`marsin_engine/tests/`):

| File | Asserts |
|---|---|
| `blend_precompile.test.js` | Boot precompile; missing blend flips `renderHealth.ok=false` and names the mode |
| `hil/hil_playlist_hotswap_test.mjs` | Deck/mixer hot-swap end-to-end (17 assertions) |
| `hil/hil_deck_swap_param_test.mjs` | Parametric swap (per-call transition override, 409 in-flight) |
| `hil/hil_deck_swap_response_test.mjs` | Mid-fade `targetEntryId` ≠ stale `playlist.activeEntryId` |
| `hil/hil_concurrent_entry_test.mjs` | Concurrent playlist-entry behavior |
| `hil/hil_channel_isolation_test.mjs` | Deck channel excluded from `/mixer` broadcast |

---

## 7. Discrepancies / follow-ups

- **`docs/19_playlists.md` §8.3 / §3.2 mark mixer-channel playlist routes as
  "Future."** They are now implemented: `GET`/`POST /mixer/channels/:id/playlist`,
  `POST /mixer/channels/:id/playlist/entry`, plus `/swap`, `/capture`, and
  `/discard`. `19_playlists.md` was not edited (out of this doc's additive
  scope); this is a documentation lag to reconcile, not a code bug.
- **`docs/18_marsin_mixer.md` §7 lists `POST /mixer/base` and
  `POST /mixer/channels/:id/pattern`** as the transition/pattern-change routes.
  The as-built channels surface drives pattern changes through the
  playlist-entry + swap routes documented here; treat `18`'s §7 as the original
  design intent, not the current API.
- The deck swap soft-transition watchdog in `PlaylistPanel.tsx` is ~8s; the
  `transition.durationMs` clamp ceiling is 30000 ms. A deck transition
  configured above ~8s would let the watchdog clear the pending-gate before the
  fade completes. Not observed as a problem at default durations; flagged for
  whoever tunes long fades.
