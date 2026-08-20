# 57 — Baby-show polish infra: flash release envelopes, quick-effect cleanup, the simplified SHOW autopilot card

**Status:** PLAN — ready for an Opus implementer ·
**Author:** agent _238 (Fable, design) · **Operator:** Sina Solaimanpour ·
**Basis (operator, verbatim):** *"make the flashes do a soft release into a
dark or soft release back to the show"* · *"remove the all white blast from
the UI"* · *"show the current pattern name on the auto pilot, and simplify the
auto pilot, play, and time, 1, 5, 10, 15 that's it"*.

Related: `docs/52_special_events_tab.md` (the Events system),
`docs/54_deck_ui_restyle.md` (UI grammar the new card must wear),
`.agent/reports/202608/20260815_230_tease_expansion_show_autopilot.md` (the
stage autopilot as built + two runner gaps folded in below, §6),
`.agent/reports/202608/20260815_231_wedding_show.md` (THE KISS — the second
consumer of the flash envelope), report `_238` (this plan's hand-off).

Three orders, one wave. Everything below is engine/schema/data/UI **infra**;
no pattern authoring. All of it is authorable show data when it lands — the
pattern-polish work happening in parallel (ChatGPT session) should **not**
build workarounds for any of it (compact contract in §8).

---

## 1. Ground truth — how a flash ends today (and why it ends hard)

The show's flash moments are the legacy **slam effects**, driven by the
special-events runner through the `effect` verb:

- `blastWhite` — `global_effects_controller.js` `applyPixels()` (line ~658):
  while ON, every channel of every pixel is held at 1.0 (`r,g,b`, plus `w`/`a`
  where the fixture has them). OFF is **instant**: the flag flips and the next
  frame is pure pattern again.
- `uvBlast` / `vintageWhite` — same shape (single-channel slams).
- `strobe` — frame-locked burst; `triggerStrobeBurst()` sets
  `strobeBurstEndFrame`, and `stopStrobe()` (line ~1399) snaps off unless the
  active config carries `fadeOutMs > 0` — **fade machinery already exists**
  (`strobeFadingOut` blend in `_applyStrobeStage`, line ~1226) but no
  special-events path ever sets `fadeOutMs`.

The runner (`marsin_engine/lib/special_events/special_events_service.js`)
fires these in `_applyEffectAction()` (line ~1161): `holdMs` → `setEffect(id,
true)`, then a release timer calls `setEffect(id, false)` — a hard cut. The
`setEffect` dep is wired in `marsin_engine/lib/api_server.js` (line ~6549);
`fireStrobeBurst` at ~6568.

**The precedent that decides the design.** `vintageWhite` already has exactly
the envelope the operator is asking for: `vintageWhiteReleaseMs` (0–5000 ms,
built for fire→lights sync). On the falling edge the boost ramps 1.0 → 0, and
per pixel it applies as `px.w = max(px.w, env)` — the decay **never pulls a
pixel below what the pattern wrote**, so as the envelope falls the live show
rises through it. A retrigger snaps back to full and cancels the ramp, so
drummed pulses read as one stab. It is computed once per frame, costs nothing
when idle, and takes an injectable `nowMs` so it is testable without sleeping
(`applyPixels(pixels, nowMs)`). We generalize this, we do not invent.

**Where the flashes live in show data today:**

| Moment | Authoring | End behavior today |
|---|---|---|
| Baby reveal (both choices) | `blastWhite holdMs: 900`, playlist swap at `delayMs: 700` **under** the flash | hard cut at 900 ms |
| Wedding THE KISS (both choices) | identical 900/700 pair | hard cut |
| Quick-effect pulses (STROBE / VINTAGE WHITE / UV BLAST / FLASH ALL WHITE) | `holdMs` 350–800 / burst 1200 ms | hard cut / snap-off |

---

## 2. Design — the FLASH RELEASE envelope

### 2.1 Where the envelope lives: the effects controller (decision)

Three candidates were considered:

1. **Runner-side fade** (the service steps something down over time) —
   rejected. The runner ticks at 1 Hz and owns no pixels; a release is
   per-frame pixel math (`max(pattern, env)`) that only the post-mixer effect
   layer can do. A runner fade could only ride the grand master, which would
   dim the *show*, not the flash.
2. **Per-effect release param in the effect layer** — **chosen**. It is the
   shipped `vintageWhite` mechanism generalized; it runs at frame rate; and it
   serves every caller (timeline `effect` actions, GEM slots, fire-sync), not
   just special events.
3. **A new "flash overlay" macro** — rejected as a second implementation of
   the same three slams; the legacy toggles are what the shows author today.

### 2.2 Controller API (`marsin_engine/lib/global_effects_controller.js`)

`setEffect(effectName, state, opts = {})` — third argument, additive,
backwards-compatible (every existing caller passes two args and gets today's
behavior bit-for-bit).

On a **falling edge** (`true → false`) with `opts.releaseMs > 0`:

```
opts = { releaseMs: 1..5000, releaseTo: 'show' | 'dark' }
```

- Envelope state generalizes the `_vwFade*` fields into a small per-effect
  map for `blastWhite`, `uvBlast`, `vintageWhite`
  (`{ active, startMs, releaseMs, releaseTo }`). `vintageWhite` keeps its
  configured `vintageWhiteReleaseMs` as the default when `opts.releaseMs` is
  absent — the fire-sync path (`setVintageWhiteReleaseMs`, Stoker panel) is
  untouched; an explicit `opts.releaseMs` wins for that one call.
- **Rising edge always snaps to full and cancels any ramp** (retrigger
  contract, unchanged from vintageWhite).
- `env = 1 − elapsed/releaseMs`, computed **once per frame** in
  `applyPixels(pixels, nowMs)`; the entry retires at zero. Idle rig pays
  nothing.

**The two release targets** (per pixel, on the channels the effect owns —
for `blastWhite` that is r,g,b and w/a where present; for `uvBlast` the u
channel; bypass-dimmer flags maintained during the release exactly as during
the hold):

| `releaseTo` | Per-channel math | What the eye sees | When to author it |
|---|---|---|---|
| `show` (default) | `px.c = max(px.c, env)` | the white decays and the **running show rises through it** — a crossfade out of the flash over live content | quick-effect pulses; the reveal / THE KISS (the new playlist is already underneath) |
| `dark` | `px.c = env` (replace; content masked for the whole release) | the white decays **to black** no matter what is underneath | a flash whose next state is dark — pair it with a `masterFade` to 0 or a blackout stage. At `env = 0` the envelope retires and the pattern owns the pixels again, so if the stage did not actually go dark the content pops back — the YAML comment must say so. This is authored intent, not a fallback. |

**Strobe** gets its exit for free: the burst path already fades when
`strobeConfig.fadeOutMs > 0`. We expose it: `fireStrobeBurst(hz, durationMs,
{ fadeOutMs })` (api_server dep, line ~6568) passes it into
`triggerStrobeBurst` meta → `setStrobe` config → the existing
`strobeFadingOut` blend, whose `scale = gate·blend + (1−blend)` already
resolves to "show through" at blend 0. No controller changes beyond threading
the meta field.

### 2.3 YAML schema (`marsin_engine/lib/special_events/show_schema.js`)

The `effect` action gains optional release fields — **authorable, bounded,
fail-loud**:

```yaml
# toggle effects (blastWhite, vintageWhite, uvBlast, invert):
- { type: effect, effectId: blastWhite, holdMs: 900, releaseMs: 700, releaseTo: show }
# strobe:
- { type: effect, effectId: strobe, hz: 6, durationMs: 1200, fadeOutMs: 400 }
```

Rules (all throw-style, in `validateEffectAction`):

- `releaseMs`: integer 0..`EFFECT_RELEASE_MS_MAX = 5000` (matches the
  vintageWhite bound and `EFFECT_HOLD_MS_MAX`). Default **0 = today's hard
  cut** — existing show files keep meaning exactly what they meant.
- `releaseTo`: `'show' | 'dark'`, default `'show'`. Present without
  `releaseMs > 0` → refused (`releaseTo` without a release is a statement
  with no mechanism — fail loud, never ignore).
- Valid with both the `holdMs` (pulse) and `state: false` (unlatch) forms;
  refused on `state: true` (a rising edge has no release).
- `fadeOutMs` (strobe only): 0..5000, default 0 (snap-off, today's behavior).

### 2.4 Runner passthrough (`special_events_service.js`)

`_applyEffectAction()` (line ~1161): the hold-expiry timer callback and the
`state:false` branch pass `{ releaseMs, releaseTo }` through
`deps.setEffect(effectId, false, opts)`. The api_server `setEffect` dep
(line ~6549) forwards `opts` to the controller.

**`_releaseAllEffects()` (line ~1114) stays instant-off.** It runs on
FINISH/ABORT/PANIC teardown; a teardown must not linger in a decay tail
(panic precedence, docs/52 §4.2). Same for `stop()`.

### 2.5 Timing interaction with the swap-under-flash (the invariant)

The reveal's choreography is: flash full ON at t=0, playlist swap at
+700 ms **under** the flash, flash off at +900 ms. The release changes only
what happens **after** 900 ms: the envelope starts at the end of the hold and
decays *from full white*, so the swap is still covered by the 100 %-white
window — the release then reveals the **new** playlist gradually. The old
look was replaced 200 ms before the envelope even starts. **The release can
never expose the swap, by construction**, as long as the swap lands inside
the hold:

> **Invariant:** in any action set pairing a `blastWhite` hold with a later
> `playlist` action, `playlist.delayMs ≤ effect.delayMs + effect.holdMs`.

This is pinned by **test** on both shipped shows (extend
`wedding_show.test.js` test 8 and add the twin to the baby sequence suite),
not by a schema refusal — a future show may legitimately flash and then swap
in the open; the two shows we ship must not. Also note `_231` §5's finding
stays load-bearing: the landing stage must not inherit a long deck
crossfade (§6 G2 fixes the latch for good).

Recommended authored values (W4; all one-line retunes):

| Moment | Release |
|---|---|
| Reveal + KISS `blastWhite` | `releaseMs: 700, releaseTo: show` — flash peaks 900 ms, then the answer colour blooms out of the white over 700 ms |
| VINTAGE WHITE pulse | `releaseMs: 800` |
| UV BLAST pulse | `releaseMs: 800` |
| STROBE burst | `fadeOutMs: 400` |
| Any future flash-into-blackout | `releaseTo: dark` + the stage's `masterFade` to 0 |

---

## 3. FLASH ALL WHITE leaves the operator surface (decision)

**Decision: remove it from show DATA, and make the removal structural in the
schema. The UI is not touched.**

- Strip the `blast_white` quick-effect blocks from every show file — 7
  blocks: `baby_reveal.yaml` (titanic, tease stage) and
  `wedding_program.yaml` (gathering / celebration / photos, titanic +
  test_bench copies).
- `validateQuickEffects` (show_schema.js, line ~584) **refuses**
  `effectId: blastWhite` anywhere inside a quick-effect action list, with a
  message directing the author to stage/choice actions ("the all-white slam
  is a staged moment, not a drummable chip").
- `blastWhite` **stays in `EVENT_EFFECT_IDS`** — the reveal and THE KISS use
  it internally as a stage action, and that is exactly where it belongs.

Why not a CaptainPad filter: the tab is a pure renderer of engine truth
(docs/52 §5); a UI filter would make the YAML lie about what the operator can
fire, and the chip would come back on any new surface. Data + schema is the
removal that cannot regress; the tests pin it.

---

## 4. The simplified SHOW autopilot card

### 4.1 What it becomes — exactly three things

The special-events stage autopilot card (`StageAutopilotCard`,
`CaptainPad/app/(tabs)/special_events.tsx` line ~454) currently renders the
deck's full `<PatternAutopilotPanel>` (cadence pills 1 s–3 m, SHUFFLE,
GROUP+SIZE/DWELL, DECK TX STYLE/TIME/SHUFFLE STYLE, countdown). Operator:
*"current pattern name … play, and time, 1, 5, 10, 15 that's it."*

The **SHOW card** becomes, top to bottom, nothing else drawn:

1. **NOW PLAYING** — the live pattern name of the deck's active playlist
   entry (`label`, falling back to the pattern id — the same precedence
   `EntryLabelEditor` uses). Updates on every rotation swap.
2. **PLAY / PAUSE** — wires to the existing sparse patch `{ active }`.
3. **Time pills `1 · 5 · 10 · 15`** — wire to `{ everySec }`.
4. *(conditional)* the existing **"Tuned live … SHOW DEFAULT"** strip, only
   when `overridden` — this is `_230`'s YAML-stays-honest affordance and it
   costs zero chrome when not overridden. It stays.

The next-swap countdown is **omitted** ("that's it"); the name changing plus
the lit PLAY carries liveness. One-line add-back if vetoed.

Everything removed from the card remains **fully authorable** in the show
YAML (`autopilot:` block — shuffle, group, transition mode/duration) and
fully reachable over the unchanged wire (`POST /special-events/autopilot`
accepts the same sparse patch; nothing engine-side narrows). The **DECK
tab's own autopilot panel is untouched** — `pattern_autopilot_panel.tsx`
stays full-featured for the deck and the cue editor.

### 4.2 The unit call: MINUTES (operator may veto)

`1 / 5 / 10 / 15` → `everySec` 60 / 300 / 600 / 900 (all inside the schema's
1..3600 bound).

Justification: 1–15 **seconds** would churn looks faster than the authored
2 s crossfade can breathe (and collides with the daemon's wait-out-the-swap
scheduling); a show hold is a minutes-scale surface — the deck pills stop at
3 m because the deck is a VJ instrument, and this card is deliberately not
one. Consequence: the tease's authored `everySec: 20` matches no pill; W4
proposes retuning the authored default to `everySec: 60`. **Both the unit
and the 60 s default are flagged for operator veto** — if he meant a faster
tease, `everySec` stays 20 and the card shows no lit pill (see next line).

A live value matching no pill lights **no pill** and renders the actual
value as small secondary text beside the bar — the card never snaps or lies.

### 4.3 Where the pattern name comes from (decision + anchors)

**Engine-side, on the existing `specialEvents` frame — no new WS type, no
second data source in the tab.**

- New dep `getDeckNowPlaying()` wired in `api_server.js` beside
  `getPatternAutopilot` (line ~6617), built exactly like
  `pushActiveEntryToModulation()` (api_server.js line ~1233):
  `mixer.getDeckChannel()` → `playlist.name` + `playlist.activeEntryId` →
  `playlistManager.load(name)` → entry → `{ pattern, label }` (null when the
  deck has no playlist entry).
- `_autopilotWire()` (`special_events_service.js` line ~1313) carries
  `nowPlaying: { pattern, label } | null`, read the same guarded way
  `nextSwapAtMs` already is (a deck read must never break the frame).
- **Broadcast on change:** a rotation swap changes deck state but fires no
  `specialEvents` frame today. The service's existing 1 s `_tick()` compares
  the last-broadcast `nowPlaying` and broadcasts on change — 1 s worst-case
  staleness on a ≥60 s cadence, no new timer, no deck-frame coupling.
- CaptainPad: `parseAutopilotState` (`utils/special_events_api.ts` line
  ~413) gains the nullable `nowPlaying` field; `useSpecialEvents` unchanged.

Rejected alternative: the tab subscribing to the deck WS `channels` frame —
it would give the Events tab a second reconcile path and engine coupling the
screen was explicitly built without (special_events.tsx header comment).

### 4.4 Component shape

New `CaptainPad/components/special_events/show_autopilot_card.tsx` replacing
the `<PatternAutopilotPanel>` usage inside `StageAutopilotCard`
(special_events.tsx lines ~480–500). Docs/54 grammar: one panel object
(surface + hairline + identity dot + uppercase `SHOW AUTOPILOT` title), PLAY
as a live-green state-tinted toggle, pills in the quiet-chip tone, name in
SpaceGrotesk. All targets ≥ 44 pt. `TimerPillBar` from
`DeckTransitionControls` may be reused for the pills if its API fits;
otherwise four plain quiet chips — do not extend the deck component for this.

---

## 5. Restart discipline (read before deploying)

Schema and service changes mean the running :6968 engine and the show YAMLs
**move together, by restart** — a `reloadLibrary()` on an old process with
new YAML (or new process with stale YAML) turns shows into red WILL-NOT-LOAD
cards mid-evening (`_230` §6). W4's YAML edits are refused by the OLD schema
only where they use new fields; the FLASH-ALL-WHITE strip is old-schema
compatible. Land engine + schema + YAML in one deploy, restart once.

---

## 6. Folded-in runner gaps (from _230/_231, both cheap here)

- **G1 — `globals` is not restore-covered** (`_231` §7.1): ARM captures only
  `captureLook()`. Add a `captureGlobals` dep using the existing
  `captureGlobalsForSnapshot()` (api_server.js line ~3474, already proven by
  PERFORMANCE MODE at ~3429); store on the run record; FINISH/ABORT restore
  via the existing `setGlobals` dep. Unlocks the `globals` verb for real
  (the wedding ceremony can pin SPEED).
- **G2 — a stage with no `autopilot:` block inherits the previous stage's
  deck transition** (`_231` §5, the 5.7 s KISS dissolve): when firing a
  stage whose `autopilot.supported === false`, the runner sets the deck
  transition to `{ enabled: false }` **before dispatching the stage's
  actions** (same ordering rule the service already documents). The wedding
  kiss's authored `transition: { enabled: false }` becomes redundant but
  stays — explicit beats implicit in show data. End-of-show restore of the
  operator's transition config is unchanged.

---

## 7. Implementation contract — ordered W-items

Shared-tree rules apply (docs/52 §6): re-read files immediately before
editing, stop on foreign conflict, never touch the live 6966–6972 stack;
offline engines on 172xx ports with `--dest 192.0.2.9` and state dirs in
scratch.

**W1 — controller release envelope.**
`global_effects_controller.js`: `setEffect` third arg, per-effect envelope
map (blastWhite, uvBlast; vintageWhite unified onto the helper), the two
`releaseTo` math modes in `applyPixels`, strobe `fadeOutMs` threading in
`triggerStrobeBurst`/`setStrobe` meta.
*AC:* new unit tests (injected `nowMs`) prove: `show` max-decay never dims
pattern content; `dark` replace-decay ends at black over bright content;
retrigger snaps full; idle cost zero; bypass flags held through release;
**vintageWhite with no opts is byte-identical to today** (fire-sync suite
stays green); two-arg `setEffect` callers unchanged.

**W2 — schema.**
`show_schema.js`: `releaseMs`/`releaseTo` on toggle-effect actions,
`fadeOutMs` on strobe actions, `EFFECT_RELEASE_MS_MAX`, quick-effect
`blastWhite` refusal (§3).
*AC:* `show_schema.test.js` covers bounds, defaults (0 / `'show'`),
`releaseTo`-without-release refused, `state:true`+release refused,
quick-effect blastWhite refused with the directing message; all existing
tests green.

**W3 — runner + deps.**
`special_events_service.js` `_applyEffectAction` passes opts on falling
edges; `_releaseAllEffects`/teardown stay instant; `api_server.js` `setEffect`
dep forwards opts, `fireStrobeBurst` gains `fadeOutMs`.
*AC:* service tests prove the hold-expiry edge carries opts and terminal
transitions do not; `special_events_api.test.js` 28/28 stays green.

**W4 — show data wave.**
`baby_reveal.yaml` (titanic) + `wedding_program.yaml` (both scenes):
authored releases per §2.5 table; strip the 7 FLASH ALL WHITE chips; tease
`everySec: 20 → 60` (**operator-vetoable**, §4.2); comments updated (the
reveal timing comment gains the release line).
*AC:* both shows load through the real loader in both scenes;
`wedding_show.test.js` updated (celebration = 3 quick effects; both copies
byte-identical) — a deliberate edit to `_231`'s suite, named in the report;
swap-under-flash invariant test added for reveal + kiss (§2.5); scene-pair
byte-identity holds.

**W5 — runner gaps G1 + G2 (§6).**
*AC:* new service tests: a stage that pins a global via `globals` leaves the
ParamCenter value restored after FINISH and ABORT; firing a no-autopilot
stage after a 5 s-crossfade stage lands its playlist as a hard cut
(regression twin of `_231` §5's measurement); full-restore tests from `_230`
B4-3 stay green.

**W6 — `nowPlaying` on the wire (§4.3).**
*AC:* `special_events_autopilot_api.test.js` extended: with rotation armed,
`nowPlaying` changes across a swap with no request in between, and matches
the deck's own `GET /autopilot` / playlist truth; `supported:false` carries
`nowPlaying: null`.

**W7 — CaptainPad card (§4.1/4.4).**
New `show_autopilot_card.tsx`; `special_events.tsx` swap;
`special_events_api.ts` parser + `EventAutopilotState.nowPlaying`;
vitest for the parser + card logic (pill mapping 60/300/600/900, no-pill
rendering, override strip gating).
*AC:* `tsc --noEmit` + eslint clean; full vitest green; deck tab and cue
editor render unchanged (no edits under `components/deck/`).

**W8 — verification.**
Offline engine (`--model test_bench`, TEST-NET-1): walk the wedding + a baby
arm-to-finish; prove the release visibly decays (sample `getStatus()` /
frame captures across the 900→1600 ms window) and the swap stays hidden;
fresh `:7167` dist screenshots: simplified card idle + playing + overridden
strip + no-pill state; quick-effect rows without FLASH ALL WHITE. Suites:
special_events (all four files), wedding_show, show_schema, CaptainPad
vitest, plus the untouched-neighbor list per ops auto-checks.

---

## 8. What the parallel pattern-polish session must NOT work around

When this lands, show YAML can author: `releaseMs` + `releaseTo: show|dark`
on flash effect actions, `fadeOutMs` on strobe bursts, and per-stage rotation
stays as is (cadence/shuffle/transition authorable; the card just shows
less). **Do not** fake soft flash exits inside patterns (no white-decay
frames authored into pattern code), do not add "flash tail" patterns to
playlists, and do not re-add FLASH ALL WHITE chips to any show YAML — the
schema will refuse them. Pattern work should assume a flash ends as a
700 ms-ish white bloom that the pattern rises through.

## 9. Open operator vetoes

1. **Time-pill unit** — minutes (60/300/600/900 s) is the design call; say
   the word and they become seconds/other values (pure UI mapping + one YAML
   default).
2. **Tease authored cadence 20 s → 60 s** (§4.2) — rides veto #1.
3. **Countdown omitted** from the SHOW card (§4.1) — one line to restore.
4. **Reveal/KISS release 700 ms** — a taste number; any 1..5000 authorable.
