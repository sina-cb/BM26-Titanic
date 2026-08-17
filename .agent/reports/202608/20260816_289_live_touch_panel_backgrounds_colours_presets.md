# `_289` — Live Touch panel: backgrounds, the colour daemon, and presets

**Agent:** Opus implementation lead + 3 Sonnet implementers.
**Branch:** `feat/bm_readiness` working tree (uncommitted).
**Contract:** `docs/70` §3/§4/§5 (design `_284`). Continues `_288`.
**Scope:** the W2/W3/W4 **panel** sides. Engine landed in `_288`.

> **No new engine code.** The restart already flagged in `_288` still
> applies and still covers everything. **No CaptainPad rebuild** — the sim
> serves `docs/ui/` from disk; a panel reload is the whole deployment.

## Result

**Proof matrix 15/20 → 22/22**, both docs/66 acceptance viewports. **F2 is
closed** — the operator's central "still very cluttered" complaint.

| | before `_289` | after |
|---|---|---|
| Portrait: where the pad starts | **68% down** (below fold) | **26% down** |
| Landscape pad area | 81,411 px² | **162,914 px²** |
| Legacy wheel area (default view) | 160,728 px² | **0** (docked) |
| Picker options | 3 | **37** (34 backgrounds + 3 instruments) |
| 44pt hit-region failures | 0/146 | **0/168** (22 controls added, still zero) |

Shots: before `~/tmp/live_touch_shots/`, after
`~/tmp/live_touch_impl/shots/after_289/`.

## W2 — background picker

Grouped `<select>`: **BACKGROUNDS** (the 34 blessed `ambient.yaml` entries,
D4) + **INSTRUMENTS** (128/129/130 unchanged, D6). A background stages
`{pattern, playlist:'ambient', entryId}`; an instrument stages the bare
`{pattern}` form — both through one shared `selectedPatternStagePayload()`,
used by the topbar handler *and* the ARM re-stage step.

**Parameters are never rendered for backgrounds**: both call sites skip
`refreshLiveExports()` entirely — not a hide flag, simply never fetched, so
hiding is total. Capability tier stamped as `data-caps`; the existing
`#patternCaps` handler picks it up for free.

**Contract correction carried from `_288`:** all 34 entries have
`label: null`, so docs/70 §3.2's "list by label" is impossible.
`backgroundEntryLabel()` prefers a real label and falls back to
`humanizeBackgroundPatternName()` — strip the `\d+_` prefix, split on `_`,
title-case (`00_golden_hour_wash` → "Golden Hour Wash"). **This fallback is
what actually renders today.** Naming guard held: "ambient" survives only as
the literal playlist filename; every identifier says "background pattern".

## W3 — the deck daemon becomes the main colour surface

Three cards against `/deck/color-autopilot` + the `colorAutopilot` WS frame:
`data-color-card="two-colour" | "palette-turns" | "follow-note"`.
`rotationKind`, `manualWriteGate`, `schemeTapOutcome`, `drivingStripModel`
ported as plain JS (reading `colors_window_logic.ts` for reference only).
Refusal sentences byte-identical to the Deck's.

Verified empirically, not assumed: STOP posts bare `{active:false}`; **no
yield gesture ever fires from Live Touch** (card hop while a family drives
issues zero requests); scheme taps are **stage-only on foreign cards**; a
failed POST is loud on both surfaces.

**The client Scriabin table is deleted** — `SCRIABIN`, `applyNoteColour`,
`noteFollowOn`, `paintNoteFollow`, `#noteFollow` and its `audionote`
listener. Zero live readers remain (grep-proven). The engine's own table in
`lib/color_schemes.js` is untouched: **one note→colour authority**.

**D8:** the old panel is retitled LEGACY COLOR and ships `is-docked`. The
existing mechanism does D8 correctly unmodified — `loadLayout()` uses
`indexOf(k) !== -1`, so a fresh profile takes the markup default (docked)
while a device whose store has COLOR open keeps it open. **No
`bm26_touch_layout_v2` version bump, no force-dock** (docs/65 §6.5). Its
five-slot 128-130 workflow was reopened and confirmed working.

## W4 — presets become an engine-backed playlist

Renders from `GET /layers/live_touch/presets` + the `liveTouchPresets`
broadcast. Rows carry `data-preset-id`, with badges, up/down, rename,
RECALL, two-tap delete, header `+SAVE`.

Capture keeps the whole v3 set (and its loud unknown-FX refusal) and adds:
`mode` (read from `[data-mode="spatial"].is-active`, **never the ordinal** —
that read caused the live inversion in `_288`), `background` as
`{playlist, entryId}` off the picker's option dataset, and `colour` as a
self-maintained mirror of the daemon broadcast. **ARM and audio bindings stay
excluded.** Recall stages mode/background panel-locally through the existing
ARM-gated paths; colour recall is an explicit POST (D11).

**Migration (D10)** verified by fetch interception: posts the non-null legacy
entries exactly once, origin-tagged, flags itself, and is correctly withheld
when the engine store is non-empty. The localStorage store is left intact as
inert legacy — never deleted, never silently orphaned.

## Two things worth flagging

**The presets panel showing "Presets store error" is CORRECT.** The live
`:6968` engine predates the `_288` routes and 404s, so the panel fails loud
rather than rendering a fake empty list — codex P0 working as intended. It
resolves on the pending restart.

**One verification is deferred, honestly.** W4 could not prove the true live
create→rename→reorder→delete→**reload** round-trip, because that needs the
restarted engine, and `~/tmp/bm26_bench_mirror_armed.json` showed an armed
bench-mirror relaying real sACN to physical controllers. It declined to
restart shared infra mid-arm and compensated with end-to-end interception
proof at the DOM/event level. **A ~2-minute re-check after the operator's
restart closes this.**

## Deviations

- **W3 edited `touch_control_wire_layers_contract.test.js`** (outside its
  file list). A **pre-existing** pin there forbade `/deck/color-autopilot`
  from appearing in the wire — directly contradicting the W3 mandate. It kept
  the two unrelated assertions and added one asserting the deliberately
  widened isolation contract (colour-autopilot allowed; still one socket;
  writes via `unownedReq`). Surfaced rather than hidden or left red. **33/33.**
- **W2 and W4 each touched `touch_control_wire.js` beyond their literal
  ranges** — W2 for `stageSelectedLivePattern` (the actual ARM stage path it
  was told to make background-aware), W4 for one `liveTouchPresets`
  passthrough branch (the only way to reach the wire-owned socket, mirroring
  W3's `colorAutopilot` branch). Both justified.
- W4 removed the presets header's REC/LBL/CLR controls — no fit in a
  playlist model.

## Gates

| Gate | Baseline | After |
|---|---|---|
| Proof harness, both orientations | 15/20 | **22/22** |
| Engine HTML-parsing contract (×3) | 32/32 | **33/33** (+1 authorized-route test) |
| Simulation panel suites (×4) | 68 pass / 1 fail | **68 pass / 1 fail** (same pre-existing `touch_control_pixel_views.test.js:158`) |
| Security scan | PASS | **PASS** |

Pins verified unchanged: theme md5 `0418472d42f81f887d822c4020d51fc3`;
`buildTransport` ×2 / `__captainpadDeliver` ×2 in theme; `captainpad_embed`
1×html + 1×theme; `DRAW_MODES[0] === 'pool'`; `data-dm` ordinals in order.
Banned files (`colors_window.tsx`, `hue_wheel.tsx`,
`colors_window_wiring.test.ts`) untouched — confirmed via `git status`.
`node --check` clean. HTML integrity polled continuously through three
concurrent editors and was never torn.

## Still open

**F6** — the EFFECTS config sheet. Now contracted as `docs/70` §10 by report
`_290`; implements as **`_291`** (PLAY/EDIT grammar; D17 slot curation is an
operator-blessed data pass, not part of it).

## Scratch hygiene

Scratch dist on `:7172` (`127.0.0.1` only — the operator's no-alternate-
loopback directive was verified against every file this wave touched: zero
violations). `CaptainPad/dist` untouched. Live stack `:6966-:6972`/`:6981`
never bound or written; all captures DISARMED. No git operations.
