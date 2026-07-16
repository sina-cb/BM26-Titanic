# MFT mixer-focus + deck-lag diagnostic review (READ-ONLY)

Date: 2026-07-09
Reviewer: Opus reviewer (read-only; no code edited, no live engine mutated)
Scope: CaptainPad MFT local-param knobs — (1) mixer locals don't follow the
focused channel, (2) deck locals work but lag.

## TL;DR

- The CaptainPad **client routing for mixer local knobs is structurally
  correct and symmetric with the deck path**. Every layer I traced reads the
  LIVE focused channel at flush time and routes a mixer write to
  `POST /mixer/channels/:id/control` with the focused overlay's id.
- The **engine is correct and symmetric too** (verified live + in source):
  overlay channels serialize a full `exports` array, and the per-channel
  control route applies writes to the addressed channel only.
- Therefore the "mixer locals don't drive the focused channel" symptom is
  **NOT a static routing defect I could isolate**. The single highest-value
  next step is a **live repro with the MFT monitor open** (below) — I could
  not drive the hardware or mutate the engine under the read-only constraint.
- The **deck lag is environmental, not structural**: writes are already
  coalesced to ~30 Hz, the ring is optimistic (repaints before the engine
  echo), and live engine round-trips measured **~1 ms**. There is one
  secondary structural amplifier (a 30 Hz React re-render fan-out on every
  knob flush) that would make *any* tab feel worse under CPU pressure —
  worth fixing but not the primary cause.

---

## What I traced (all read-only)

Decode → resolve → accumulate → flush → dispatch → api → engine, for the MFT
`focusedParamKnob` (rows 1–3 = 12 local-param knobs).

### 1. Profile is context-agnostic (deck ≡ mixer decode)
`CaptainPad/midi_profiles/mft.yaml` is a **flat `controls:` profile** (no
`contexts:` map). `validateProfile` normalises it to
`contexts = { default: [...] }` (`utils/midi/profile.ts:509,516`), and
`controlsForContext` returns `profile.controls` for ANY requested context when
the only context is the synthetic `default`
(`utils/midi/resolver.ts:165-172`). So the 12 knobs resolve to
`focusedParamDelta` **identically in deck and mixer** — the context does not
change MFT decode. (Confirmed the MFT is the "context-free" profile per the
header note at mft.yaml:23.)

### 2. The flush routes by the LIVE focused channel (not a captured/stale one)
`utils/midi/manager.ts:1470-1501` (`flushResolved`, `focusedParamDelta`):
- reads `this.opts.getSnapshot().focused` **at flush time**,
- N3 mid-window guard: drops only if `capturedKey !== focused.key`
  (`1477`) — `focused.key` is `role:id:entryId:mappingIds`, stable for a
  fixed channel+entry, so it does not spuriously fire,
- writes `{ kind:'localParam', role: focused.role, channelId: focused.id,
  exportId: exp.id, value }` (`1499`).

Dispatch (`utils/midi/dispatch.ts:209-214`): `role==='deck'` →
`setDeckChannelControl`; else → `setMixerChannelControl(channelId, exportId, …)`.

Api (`utils/api.ts:1878-1893`): mixer → `POST /mixer/channels/${channelId}/control`;
deck (`1184-1199`) → `POST /deck/channel/control`. **Distinct routes, both
present, mixer carries the focused overlay id.**

### 3. `_snapshot.focused` is built symmetrically for both contexts
`hooks/useMidiControl.ts:805-901`:
- `ctx = _activeContext`; `focusLayer = ctx==='deck' ? 0 : _focusedLayer`
  (`816`); `focusChan = ctx==='deck' ? engine.deckChannel : channels[focusLayer]`
  (`817-819`); `role = ctx==='deck' ? 'deck' : 'mixer'` (`875`).
- exports for BOTH built from `deriveKnobOrder(focusChan.exports)` (`850`) —
  no deck-only gate.
- Out-of-range focus resets to 0 with a loud note (`810-815`).
This block is **unchanged on this branch** (`git diff` shows only the import
line moved), so it is the pre-existing, presumed-working structure.

### 4. Focus source of truth is shared (no split-brain)
- Mixer UI `app/(tabs)/mixer.tsx:1052` calls `setMidiFocus(layerIndex)` and
  reads `useIsMidiFocused` — same `_focusedLayer` module state the APC/MFT use.
- APC focus buttons → `focusChannel layer 0..3`
  (`midi_profiles/apc_mini_mk2.yaml:90-104`) → `handleFocus` →
  `setFocusIntent` (`manager.ts:1084`) → sets `requestedFocusLayer` AND fires
  `onFocusChange → setMidiFocus → _focusedLayer` (`useMidiControl.ts:299-306`).
- Touch: `setMidiFocus` sets `_focusedLayer` first, then `_setFocusIntent →
  requestedFocusLayer`. **The two focus stores stay in sync in every path.**
- Context publish: `mixer.tsx:1426` `setMidiActiveContext('mixer')`,
  `index.tsx:338` `setMidiActiveContext('deck')`, both in `useFocusEffect`.
  `setMidiActiveContext` bumps focus → snapshot rebuild for the new context
  (`useMidiControl.ts:578-585`).

### 5. Engine side (verified live at :6968 AND in source by a sub-agent)
- `serializeMixerState()` serializes **every overlay's `exports`** the same
  way `serializeChannel()` does the deck
  (`marsin_engine/lib/api_server.js:2808-2874` vs `2650-2719`).
- `POST /mixer/channels/:id/control` exists and applies via
  `paramRouter.setChannelControl(id, data.id, data.v0, …)`
  (`api_server.js:6535-6552`); deck mirror at `7862-7881`.
- Per-channel isolation is unit-tested
  (`marsin_engine/tests/channel_param_isolation.test.js:96-126`).
- **Live check right now:** overlay `ch_1783569272925_219` returns 12 kind-1
  sliders with real v0; deck returns 6. The mixer `channels` array excludes
  the base/deck channel (index 0 = first overlay), so `channels[_focusedLayer]`
  correctly points at overlays.

> NOTE on export ids: slider export ids are a **hash of the param name**, so
> the deck and every overlay reuse the SAME id for e.g. `sliderLocalSpeed`
> (`1037917937`). The id alone does not identify a channel — correct routing
> therefore DEPENDS on the write carrying the right `channelId`, which the
> client does. If a future refactor ever dropped the channelId and addressed
> a write by export id alone, deck+overlays would cross-write. Not the current
> bug, but a latent trap worth a guard.

---

## Answers to the three required questions

### Q1 — Root cause of "mixer locals don't follow the focused channel"
I could **not** reproduce this as a static routing defect. Under read-only
constraints (no MFT hardware, no engine mutation) the entire client path and
the engine are correct and symmetric with the working deck path, and the live
engine state has valid per-overlay exports and a working per-channel route.

The most probable **remaining** causes, in order, to confirm with a live
repro (see "How to confirm" below):

1. **A live focus-state condition, not code.** If `_activeContext` never
   flipped to `'mixer'` (e.g. the operator reached the mixer view via the APC
   Shift `toggleDeckMixerView` router.navigate rather than a tab focus, so the
   mixer tab's `useFocusEffect` that calls `setMidiActiveContext('mixer')` did
   not run), the knobs would still be in **deck** context — writing to the deck
   channel, which *looks like* "mixer locals do nothing to the focused
   overlay." `toggleDeckMixerView` (`useMidiControl.ts:599-610`) navigates but
   relies on the destination screen's `useFocusEffect` to publish context; if
   that effect is gated/slow, context lags. **This is my leading hypothesis**
   and is the cheapest to check (read `_activeContext`/the header while on the
   mixer with the MFT).

2. **`focused` is null on the mixer** because the focused overlay was deleted
   or the operator never pressed a focus button AND `channels[0]` momentarily
   absent — then `flushResolved` hits `if (!focused) return` (`1474`), a
   silent drop. The reset-to-0 guard (`useMidiControl.ts:810-815`) covers the
   deleted-overlay case but only on the next rebuild.

3. **A learned binding collision** consuming the knob at
   `applyBinding` (`manager.ts:942`, runs BEFORE profile resolve): if the
   focused overlay's active entry has an enabled learned binding whose control
   matches an MFT knob CC, `applyBinding` returns `true` and the profile
   `focusedParamKnob` path is never reached. Plus the mixer-only staleness
   gate (`1739-1744`) can consume-without-writing while
   `requestedFocusLayer !== focused.layer`. Deck never hits this gate (single
   channel, layer always 0), which would explain deck-works/mixer-doesn't for a
   learned-binding user. Only relevant if the operator has learned faders.

### Q2 — Why deck works but mixer doesn't (the exact divergence)
On the **deck** tab `role='deck'`, `focusLayer=0`, and `requestedFocusLayer`
never diverges from `focused.layer` (the deck is a singleton, always focused),
so **no focus-settling / staleness gate ever engages** and context is
published by the deck screen's `useFocusEffect` on entry. On the **mixer** tab
`role='mixer'`, correctness depends on two extra live facts that the deck path
gets for free: (a) `_activeContext==='mixer'` actually being set, and (b)
`_focusedLayer` pointing at a live overlay whose snapshot `focused.layer`
matches `requestedFocusLayer`. Every mixer-only consume-without-write path
(`manager.ts:1474`, `1477`, `1739-1744`) is silent by design. The divergence
is therefore in the **mixer-only preconditions**, not in the write itself.

### Q3 — Deck lag: structural or machine?
**Machine/environmental, with one secondary structural amplifier.**
- Evidence AGAINST a structural per-tick round-trip: knob deltas are
  **coalesced to one write per ~33 ms window** (`coalescer.ts`,
  `DEFAULT_COALESCE_MS=33`, `manager.ts:308,618`); the ring repaints
  **optimistically before** the dispatch (`manager.ts:1497` then `1498`), so
  the knob feels live regardless of engine speed; measured live engine
  round-trip **~1 ms** for a control-shaped GET. No retry/stacking in
  `fetchWithTimeout` (`api.ts:26-42`, 8 s timeout, single fetch).
- Secondary structural amplifier (fix, but not the cause): **every** flush
  calls `setStatus({ lastEvent })` → `notify()` → `onStatusChange` →
  hook `_set` → all `useMidiStatus()` subscribers re-render, at ~30 Hz while a
  knob moves (`manager.ts:625-628, 640, 649-663, 1494, 2131-2133`). Under CPU
  pressure this 30 Hz React fan-out competes with the render thread and makes
  the whole app (deck included) feel laggy. It is not deck-specific, but the
  deck screen is heavier (viz strips), so it shows there first.

---

## How to confirm (live, next agent / operator)
1. On the **mixer** tab with the MFT connected, open the CaptainPad MIDI
   monitor / status `lastEvent`. Twist a local knob.
   - `lastEvent` shows `knob <name> = <v>` but the light doesn't move →
     the WRITE is firing to a channel; check WHICH channel id it hit
     (hypothesis 1/2: wrong/deck channel or null focus).
   - `lastEvent` shows `bind … (focus settling → ch N)` or nothing →
     consume-without-write (hypothesis 3 / staleness gate).
2. Log/inspect `_activeContext` while on the mixer (hypothesis 1). If it reads
   `'deck'`, the fix is to make context-publish robust to the APC-Shift
   navigation path, not the routing.

## Concrete fix candidates (scoped to CaptainPad; pick after the live repro)
- **If hypothesis 1 (context not published):** make `toggleDeckMixerView`
  (`useMidiControl.ts:599-610`) also call `setMidiActiveContext(target)`
  directly instead of relying solely on the destination `useFocusEffect`, OR
  audit `mixer.tsx:1421-1431` for a gate that skips the `setMidiActiveContext`
  on the APC-nav entry. **file:line: `useMidiControl.ts:604-605`.**
- **If hypothesis 2 (null focus):** surface a loud `lastEvent` in
  `flushResolved`'s `if (!focused) return` (`manager.ts:1474`) — today it is a
  silent drop; make it `knob (no focused channel — inert)` like the hue path
  does (`manager.ts:1227`). **file:line: `manager.ts:1474`.**
- **If hypothesis 3 (staleness/binding consume):** the mixer staleness gate
  (`manager.ts:1739-1744`) is for learned faders only; confirm the operator
  isn't using a learned binding that shadows an MFT knob CC.
- **Deck-lag amplifier (independent, safe to do now):** gate `setStatus`'s
  `notify()` so a `lastEvent`-only change does NOT fan out to
  `useMidiStatus()` at 30 Hz — split the high-churn `lastEvent` onto its own
  low-priority store/selector (mirror the `useEngineState` split-bus pattern)
  or drop `lastEvent` updates below a coalesced cadence.
  **file:line: `manager.ts:625-628` + `useMidiControl.ts:1018-1020` (`onStatusChange`).**

## Loud-fail nit spotted in passing (not the bug)
`setMixerChannelControl` (`utils/api.ts:1878-1893`) returns `{ ok:true }` even
when `res.ok` is false (line 1889) — an engine rejection of a mixer control
write is swallowed as success. `updateMixerChannel` was already fixed for this
(`api.ts:1214-1216`); `setMixerChannelControl` and `setDeckChannelControl`
(`1184-1199`) still have the old shape. This would HIDE a failing mixer write —
relevant to debugging Q1 (a rejected write looks like a no-op). Worth aligning
with `updateDeckChannel`'s `res.ok` handling.
