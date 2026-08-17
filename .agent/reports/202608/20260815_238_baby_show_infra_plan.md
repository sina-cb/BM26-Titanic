# _238 — Baby-show polish infra: the plan (flash release, chip removal, simple SHOW card)

**Role:** DESIGNER/PLANNER (Fable). **Branch at start:** the prompt said
`feat/bm_readiness`; `git status` at session start showed
`feat/bm_audio_tuning` checked out — irrelevant to this session because **no
git operations were run and zero product code was edited**. Deliverables are
docs only: `docs/57_baby_show_polish_infra.md` (new), this report, and a
tracker block. Shared tree honored: `_235/_236/_237` files untouched.

**Operator's orders (verbatim):** soft-release the flashes "into a dark or …
back to the show"; "remove the all white blast from the UI"; "show the
current pattern name on the auto pilot, and simplify the auto pilot, play,
and time, 1, 5, 10, 15 that's it".

---

## 1. What was studied (anchors)

- `marsin_engine/lib/global_effects_controller.js` — `blastWhite` is a hard
  per-channel slam in `applyPixels()` (~line 658) with an instant falling
  edge; **`vintageWhite` already ships the exact envelope wanted**
  (`vintageWhiteReleaseMs` 0–5000, `max(pattern, env)` decay, retrigger
  snap, injectable `nowMs`) at ~72–89/553–566/617–653; the strobe already
  has an unused-by-shows fade path (`strobeFadingOut` blend ~1226–1295,
  `fadeOutMs` in `stopStrobe` ~1399).
- `marsin_engine/lib/special_events/special_events_service.js` —
  `_applyEffectAction` (~1161) does `setEffect(id,true)` → release timer →
  `setEffect(id,false)`; `_releaseAllEffects` (~1114) is the terminal
  instant-off; `_autopilotWire` (~1313) is where `nextSwapAtMs` (and now
  `nowPlaying`) rides the frame.
- `marsin_engine/lib/api_server.js` — deps `setEffect` ~6549,
  `fireStrobeBurst` ~6568, `getPatternAutopilot` ~6617;
  `captureGlobalsForSnapshot()` ~3474 (used by PERFORMANCE MODE ~3429 —
  the ready-made fix for `_231` §7.1); the deck now-playing recipe already
  exists as `pushActiveEntryToModulation()` ~1233.
- Show data: `baby_reveal.yaml` (reveal = master 200 ms + blastWhite 900 ms
  + playlist at +700 ms under it), `wedding_program.yaml` ×2 scenes (KISS
  identical pair) — 7 FLASH ALL WHITE quick-effect blocks total.
- UI: `special_events.tsx` `StageAutopilotCard` (~454) reuses
  `<PatternAutopilotPanel>` verbatim; `special_events_api.ts`
  `parseAutopilotState` (~413); deck panel + cue-editor reuse confirmed so
  the deck surface stays untouched.
- Context: `_230` (autopilot as built + restart hazard §6), `_231` (KISS
  cut finding §5; the two runner gaps §7), docs/52, docs/54.

## 2. The design, in one breath each (full detail: docs/57)

1. **Flash release = generalize the shipped vintageWhite envelope.**
   `setEffect(name, false, { releaseMs 1..5000, releaseTo: 'show'|'dark' })`
   in the effects controller — `show` decays via `max(pattern, env)` so the
   live show rises through the flash; `dark` replaces (`px = env`) so the
   flash lands at black, authored alongside a dark stage. Strobe exits via
   the existing `fadeOutMs` blend, just threaded through `fireStrobeBurst`.
   YAML: `releaseMs` / `releaseTo` on effect actions, `fadeOutMs` on strobe;
   defaults 0/`show` = today's behavior. The swap-under-flash stays hidden
   **by construction** (release starts at hold end, i.e. 200 ms after the
   +700 ms swap, decaying from full white over the NEW playlist); invariant
   `playlist.delayMs ≤ flash delay+hold` pinned by test on both shows.
   Runner terminal teardown (`_releaseAllEffects`, panic) stays instant.
2. **FLASH ALL WHITE removal: data + schema, not a UI filter.** Strip the 7
   quick-effect blocks; `validateQuickEffects` refuses `blastWhite` in
   quick-effect actions permanently; the verb stays in `EVENT_EFFECT_IDS`
   for stage actions (reveal, KISS). The tab remains a pure renderer.
3. **SHOW autopilot card = NOW PLAYING name + PLAY + pills 1/5/10/15
   (minutes → everySec 60/300/600/900), plus the existing SHOW DEFAULT
   strip only when overridden.** Countdown cut. Name comes engine-side: new
   `getDeckNowPlaying()` dep → `nowPlaying: {pattern, label}|null` on the
   existing `specialEvents` frame, broadcast-on-change from the 1 s tick —
   no new WS type, no deck-frame coupling in the tab. New
   `show_autopilot_card.tsx`; `PatternAutopilotPanel` untouched (deck + cue
   editor keep the full panel). Non-pill live values light no pill and are
   shown as text — the card never snaps or lies.
4. **Folded-in runner gaps:** G1 ARM captures globals
   (`captureGlobalsForSnapshot`) and restores on FINISH/ABORT — the
   `globals` verb becomes safe; G2 a no-`autopilot:` stage gets the deck
   transition reset to `{enabled:false}` before its actions — the KISS
   dissolve class of bug dies engine-side.

## 3. Decisions made (and what the operator can veto)

| Decision | Call | Veto path |
|---|---|---|
| Envelope home | effects controller (frame-rate pixel math; serves timeline/GEM too), not the runner | — |
| `releaseTo: dark` semantics | replace-decay to black; author pairs with a dark stage (documented, fail-visible, no fallback) | — |
| Chip removal mechanism | YAML strip + schema refusal in quick effects; keep verb for stage actions | — |
| Time-pill unit | **minutes** (seconds at 1–15 would out-run the crossfade; show holds are minutes-scale) | **open veto #1** |
| Tease authored cadence | 20 s → 60 s so a pill is lit at ARM | **open veto #2**, rides #1 |
| Countdown on SHOW card | omitted ("that's it") | **open veto #3**, one line |
| Reveal/KISS release length | 700 ms | taste; any 1..5000 |

## 4. Hand-off notes for the implementer

- Ordered W1–W8 with acceptance criteria + test plan: docs/57 §7. W1–W3
  are engine (controller → schema → runner/deps), W4 the data wave (this is
  the slice that deliberately edits `wedding_show.test.js` expectations —
  celebration drops to 3 quick effects), W5 gaps, W6 wire, W7 CaptainPad,
  W8 verification.
- **Restart discipline (docs/57 §5):** schema + YAML + engine move together
  in one restart; `reloadLibrary()` across the version seam produces red
  WILL-NOT-LOAD cards (`_230` §6).
- Offline verification only: 172xx ports, `--dest 192.0.2.x`, scratch state
  dirs, fresh `:7167` dist for screenshots (memories: bm26-port-topology,
  operator-manages-expo, metro-stale-watcher).

## 5. Residue

None. No product files touched; no engines started; no ports bound; the
live stack was never contacted. New files: `docs/57_baby_show_polish_infra.md`,
this report, one tracker block.
