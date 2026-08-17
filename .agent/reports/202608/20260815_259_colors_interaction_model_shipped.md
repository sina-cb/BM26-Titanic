# _259 — COLORS interaction model SHIPPED: FOLLOW NOTE yields on leave, every mode visible everywhere

**Date:** 2026-08-15 · **Role:** Opus lead + validator, four Sonnet
implementers · **Contract:** `docs/61_colors_interaction_model.md` (design
report `_255`, Fable) · **Scope:** CaptainPad client only — **zero engine
source files touched**, no restart dependency.

**Operator order (verbatim intent):** *"check the color live control in the
deck tab please. I just got a conflict with follow note. when going from
follow note to another tab for example, it should safely disable the follow
note so it's not confusing. for the others too — plan interaction and
mechanism of the color."*

Shipped with Fable's recommended defaults for D1–D7. Every default remains a
**one-line veto** (§7 below).

---

## 1. What the operator gets

- **FOLLOW NOTE yields when you leave it.** Switching the COLORS mode card
  (L1), hiding the COLORS window (L2), or leaving the Deck tab (L3) while
  follow-note is driving posts a bare `{active:false}` — narrated `FOLLOW
  NOTE stopped — colours frozen in place.` The look the music last chose
  stays on the rig; the mode and all of the operator's cycle tuning survive,
  so a later START resumes his cycle without re-sending it.
- **TURNS / crossfade / palette-set persist everywhere** (D2) — they are
  staged, cadenced ambience and browsing must not be destructive.
- **One DRIVING STRIP** sits above the transport on every card that is not
  the running family's own, saying what is driving and carrying an inline
  **STOP**: `◉ FOLLOW NOTE IS DRIVING · G · COMPLEMENT [STOP]`.
- **Refusals name the driver**: `FOLLOW NOTE is driving the colours — STOP it
  to edit.` (was the kind-agnostic "A colour rotation is driving…").
- **The scheme trap is closed (C3).** Tapping COMPLEMENT on the TWO COLOUR
  card while follow-note runs no longer PATCHes `followNote.method` — it
  stages only and says so. `method-override` is reachable **only** from the
  FOLLOW NOTE card.
- **The blend scrubber goes inert under follow-note (C4)** — flat track, `—`
  readout, no chasing thumb, one line pointing at the strip.
- **The window opens on the running family's card (C7)**, once per entry.
- **An app-wide chip on every tab** — `◉ COLORS · FOLLOW G / TURNS / XFADE /
  SET` — answers C5's "my colour pick got eaten on the Mixer with no visible
  cause". Read-only: tapping navigates to the Deck and restores the COLORS
  window, it never stops anything.

## 2. Slices, and who did what

| W | Owner | Files | Landed |
|---|---|---|---|
| W1 | Sonnet A | `colors_window_logic.ts` (+test), new `utils/deck_window_requests.ts` (+test) | `manualWriteGate(disabled, kind)`, `schemeTapOutcome(kind, title, surface)`, `yieldDecision`, `drivingStripModel`, `colorChipLabel`, `cardForKind`, `kindLabel`, `takeoverNote`, the D1/D2 veto constants, `YIELD_SAY` / `YIELD_FAIL_SAY` |
| W2 | Sonnet B (+B2 fixes) | `colors_window.tsx`, new `colors_window_wiring.test.ts` | driving strip + inline STOP, L1 yield on the mode buttons, entry auto-select, surface-aware scheme taps, inert blend under follow-note, loser-named takeover messages, `visible` / `onCardChange` props |
| W3 | Sonnet C | `app/(tabs)/index.tsx`, new `colors_yield_bridge.ts` (+test) | L2 (workspace close) + L3 (Deck-tab blur) triggers off gesture-time refs, `handleColorAutopilotChange(patch, failNote?)`, the deck-window-request subscriber |
| W4 | Sonnet D | `hooks/useEngineState.ts`, new `utils/color_autopilot_frame.ts` (+test), new `components/ui/color_mode_chip.tsx`, `app/(tabs)/_layout.tsx` | app-wide `colorAutopilot` frame + `useColorAutopilotFrame()`, the header chip mounted in the shared sidebar rail |
| W5 | Opus (this report) | none | isolated-engine walk, two-tab race, 10-shot matrix |

**What the lead corrected.** Two defects the Sonnets' own gates could not
catch, both found by the W5 walk on a real dist against a real engine:

1. **Entry auto-select never fired on a cold open (C7 still open).** The
   one-shot was keyed on the `visible` false→true transition, but the window
   mounts *before* the deck screen's `colorAutopilot` is seeded, so `kind`
   was still `'none'`, `cardForKind` answered `null`, and the one-shot burned.
   Measured: engine armed with follow-note, fresh dist → the window sat on
   TWO COLOUR with the strip showing `FOLLOW NOTE IS DRIVING`. Fixed to an
   **armed** one-shot: the visible transition *arms*, the first later render
   with a resolvable card *fires and disarms*.
2. **A parked operator's card could be yanked.** `goCard` early-returned on a
   same-card tap before reaching the disarm, so the one-shot stayed live
   indefinitely and a remotely-armed family would claim the card. Fixed by
   moving the disarm above the early return: **any** deliberate tap on the
   mode selector retires the one-shot for that visibility episode. Pinned by
   a source-order assertion so a refactor cannot silently reorder them.

Also corrected by the lead: two new `@typescript-eslint/array-type` warnings
in `colors_yield_bridge.test.ts`.

## 3. W5 validation — the evidence

**Isolated engine**: port **17968**, `--dest 192.0.2.x` (TEST-NET-1
blackhole), redirected `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR`, and a
scratch `MARSIN_CONFIG_FILE` with **OSC and fire-sync disabled** — the first
boot attempt co-bound UDP :10000 and :7703 alongside the live engine, which
would have stolen its datagrams; the scratch config closes that. Operator
ports 6966-6972 and sACN 5568 were never touched; the live engine on :6968
stayed healthy throughout.

### 3.1 Engine wire properties (HTTP, pre-UI)

| Property | Result |
|---|---|
| Bare `{active:false}` on follow-note | `active:false, mode:followNote`, `followNote` block **byte-identical** (`schemes/methodHoldS:42/methodFadeS:7/noteFadeMs:1234/sel:[1,3]/shuffle:true`) |
| Freeze-in-place | `colorPalette1/2` identical at stop, +3 s, +6 s |
| Resume without re-sending | bare `{active:true}` → same cycle, same tuning |
| Legacy-shape stop | bare `{active:false}` stops a **palettes** rotation too (pre-`_248` property, §1.8) |
| followNote rides palettes mode inert | tuning still present after a palettes takeover |

### 3.2 Two-tab race

Tab A arms follow-note → tab B posts a legacy palettes takeover (no `mode`
field) → tab A's gesture lands a beat later as a bare stop. Observed:
**HTTP 200, `active:false, mode:palettes`, follow-note tuning still carried
inert.** No error surfaced, no mode resurrected — the invariant holds.

### 3.3 The 10-shot matrix (`~/tmp/fix_256/`, all inspected)

| # | Shot | Proof |
|---|---|---|
| ① | follow running, follow card | card = `follow` (auto-selected), strip absent |
| ② | tap TWO COLOUR | card = `two`, strip absent, message `FOLLOW NOTE stopped — colours frozen in place.`, engine `active:false mode:followNote` **tuning intact**, palette identical across 3 reads |
| ③ | remote-armed follow, window opens | card auto-selected to `follow` |
| ④ | remote-armed follow, operator on TURNS | strip `◉ FOLLOW NOTE IS DRIVING / G · COMPLEMENT / STOP`, engine still `active:true` |
| ⑤ | wheel drag refused | `FOLLOW NOTE is driving the colours — STOP it to edit.` |
| ⑥ | scheme tap on the TWO card under remote follow | `FOLLOW NOTE is driving — this stages only. STOP it (strip above) to write A/B.` — engine `followNote` **unchanged** (no `method` key written). **C3 closed.** |
| ⑦ | Mixer tab | header chip `◉ COLORS · FOLLOW G` |
| ⑧ | engine unreachable mid-yield | engine still `active:true`, strip still showing, narration `… Couldn't stop FOLLOW NOTE — it is still driving.` |
| ⑨ | blend under follow-note | flat inert track, `—` readout, `FOLLOW NOTE is driving — the blend has no endpoints while the music picks the hue.` |
| ⑩ | TURNS through an L1+L2+L3 round trip | still `active:true`, `delay_s:5`, `transitionMs:800`, ring 5 — **cadence identical**; chip reads `◉ COLORS · TURNS` |

Shots ④/⑥/⑦/⑨ initially "failed" because the harness drove them from a
running follow card — where the tap **correctly** fired the L1/L3 yield. That
is positive evidence the yields fire; the shots were re-staged as the genuine
remote-armed case (park first, arm from the wire) and then passed.

## 4. Gates

- **CaptainPad suite: 95 passed / 1 failed / 1963 passed tests / 6 skipped.**
  The one failure is **FOREIGN and reported, not fixed**: the concurrent
  `_257` Deck-declutter wave added `DeckBarId` / `'audioBar'` to
  `deck_workspace_layout.ts` while this wave validated, breaking its own
  `deck_workspace_layout.test.ts > stamps the CURRENT window set on every
  write` and producing the one `tsc` error (`DeckSurfaceId` not assignable to
  `DeckWindowId`, `deck_workspace_layout.test.ts:189`). No file, symbol or
  test of this wave is involved.
- **This wave's five suites: 322/322 green** (`colors_window_logic`,
  `colors_window_wiring`, `colors_yield_bridge`, `color_autopilot_frame`,
  `deck_window_requests`).
- **`npm run lint`: 0 errors, and zero warnings in any file this wave
  touched.** (Total warnings rose 17 → 25 from the concurrent `_257` work.)
- **`npm run web:build`: succeeds.** Exported to a **scratch** directory
  throughout — `CaptainPad/dist` is now served live on :6967 by the PROD
  launcher, and rebuilding it in place would have re-deployed under the
  operator mid-session.
- **`_217` no-timer gate: green** — zero `setInterval` / `requestAnimationFrame`
  in the COLORS window files, asserted by a source-text test.

**Build note worth keeping:** three agents running `expo export` concurrently
corrupted the metro cache and produced a bundle that rendered a blank page
with `Cannot read properties of undefined (reading 'filter')`. An unminified
export and a clean re-export both rendered fine. **Never run parallel
`expo export`s in this tree** — the failure looks exactly like a product
crash.

## 5. What did NOT change (contract §6, all verified)

The `_242` dial · the `_224` shared transport · the `_217` no-timer rule ·
the single-writer gate's strength (no gesture path auto-pauses the daemon;
`_211` §D survives, re-scoped to gestures) · the engine wire (no new routes,
no lease, no deadman, no schema change) · `ColorAutopilotPanel`'s `_248`
banner · the timeline `setColorAutopilot` cue path · plan-lock gating
(`disabled` suppresses yields and STOP alike) · live PATCH retune behaviour
and the `RetuneLine` microcopy.

## 6. Known, documented residue

- **A parked operator who never touches the mode selector** can still have
  his card claimed by a remotely-armed family, because the entry one-shot is
  still live. This is the intended §4.3 behaviour (show what is running); a
  single tap pins the selection. Documented in the code.
- **D7 stands deferred**: Mixer/CPC/MIDI colour writes remain ungated at
  `/param-center`. The chip names the cause; an engine-side write gate would
  be a new refusal surface across every writer, including patterns.
- **C6 remains by design**: a legacy palettes-shaped POST still ends
  follow-note by `inferMode`. Visibility (strip + chip flip on the next
  broadcast) is the mitigation; the wire is deliberately unchanged.

## 7. Operator vetoes still open (each a one-liner)

| # | Shipped default | Veto |
|---|---|---|
| D1 | yield on L1 **and** L2 **and** L3 | flip `YIELD_ON_CARD_SWITCH` / `YIELD_ON_WINDOW_HIDE` / `YIELD_ON_TAB_LEAVE` in `colors_window_logic.ts` |
| D2 | only FOLLOW NOTE yields | add `'turns'` / `'crossfade'` to `YIELD_KINDS` |
| D3 | chip on all tabs, every family | unmount `<ColorModeChip />` in `app/(tabs)/_layout.tsx`, or narrow `colorChipLabel` |
| D4 | kind-named gate sentence | revert `manualWriteGate`'s per-kind arm |
| D5 | **no** engine deadman/lease | would be a separate engine slice, not a veto |
| D6 | entry auto-select on | delete the armed-one-shot effect |
| D7 | no `/param-center` colour write gate | file separately |

## 8. Residue / constraints honoured

No git operations. All scratch under `~/tmp/colors_w5/` and `~/tmp/fix_256/`.
No ports below 17000 bound; live stack (`:6968` engine, `:6967` dist) never
touched — the scratch dists were served on 7178-7183 and pointed at the
scratch engine only. The scratch engine wrote no state into the tracked
`marsin_engine/states/`. No engine source file was modified.
