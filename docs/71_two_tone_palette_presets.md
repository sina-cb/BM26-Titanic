# 71 — Two-tone palette presets: one store, every menu

**Status:** DESIGN (report `_296`, Fable). Awaits one Opus lead + Sonnet
implementers as `_297`, gated on the coordinator's pre-wave git checkpoint.
**Operator order (verbatim, 2026-08-16):** *"the colors and color cue that we
have, in the deck and mixer, in the global line — see if you can make the
color wheel save 2 toned color palettes to that menu too. I want a nice way
to manage the preset 2 color swatches in our system."*

Builds on docs/36, docs/53 §4/§8, docs/61, and reports `_211`/`_242`/`_259`/
`_264`/`_282`/`_288`. One small engine slice (W2) — **engine restart
required**, batches into the restart already pending from `_283`/`_288`.

---

## 0. Operator pins (the constitution for this wave)

- **P1 — the COLORS panel owns capture AND management.** The global line may
  render and apply presets; save/rename/reorder/delete live in the COLORS
  window UI, nowhere else.
- **P2 — the picking grammar and the colour-autopilot system are FROZEN.**
  Presets are purely additive and feed the existing pipeline exactly as if
  the operator had dialed the colours by hand. Zero behavioural change when
  the feature is unused.
- **P3 — minimal additive shape.** A byte-identical invariant list (§8,
  test-pinnable); every decision independently vetoable (§9); any change
  inside an existing colour mechanism is escalated to the operator, never
  quietly contracted.
- **Dead-code ruling.** If a preset path is superseded, its removal is its
  own vetoable W-item with proof (no callers, no persisted state routed
  through it, or a loud migration). Census verdict: **no dead path exists**
  (§1.4) — this wave removes nothing.
- **Checkpoint gate.** `_297` starts only after the coordinator lands a git
  checkpoint (commit + tag) of the pre-colour-presets tree.

## 1. Census — what "that menu" is, and the one gap

Three colour-preset surfaces exist today. None is dead. Exactly one gap
explains the operator's sentence.

| Surface | Component | Store | Writable |
|---|---|---|---|
| **GLOBAL LINE** (deck + mixer) — COLORS tile + QUEUE tile ("the colors and color cue") | `CPCControls.tsx:340-360` → `ColorPickerModal` / `ColorQueueModal` | `GET /color-palettes` = the 23 tracked `config.yaml:356` entries `{id,name,c1,c2}` | read-only |
| **COLORS window** "Saved palettes" gallery | `colors_window.tsx:1680-1732` | `GET/POST /color-pairs` → `states/<scene>/color_pairs_state.yaml`, schemaVersion 2 | yes — SAVE PALETTE shipped in `_242` |
| COLORS window "Show palette" (collapsed) | `colors_window.tsx:1734-1779` | the same `/color-palettes` library | read-only |

Load-bearing census facts:

1. **The GLOBALS line is ONE component mounted twice** — deck
   `index.tsx:1242`, mixer `mixer.tsx:3232`. Nothing is forked. A change
   inside `ColorPickerModal`/`ColorQueueModal` lands on both tabs with zero
   screen-file edits (no `mixer.tsx` diff → no docs/69 collision).
2. **The wheel already saves named two-tone palettes.** `SAVE PALETTE`
   (`colors_window.tsx:1684`, handler `:961-997`) stores `{c1,c2,name?}`
   (bare pair) or `{…,ring,sel,scheme,base}` (latched scheme), icon drawn by
   `components/ui/preset_icon.tsx` from `presetIconColours`, name via
   `opPrompt` (`''` = unnamed, `null` = cancel), duplicates (by COLOURS) and
   the 24-cap refused BEFORE the name prompt.
3. **Both apply paths already converge.** Library tap:
   `pickPreset → writeColors(p.c1,p.c2)` (`ColorPickerModal.tsx:177-182,
   :144-149`); gallery tap: `loadPreset → setBothSlots → writeNow`
   (`colors_window.tsx:1006-1016, :342-347`). Both end in the SAME atomic
   `POST /param-center` `{colorPalette1:{h,s:1,v:1}, colorPalette2:{h,s:1,v:1}}`
   — the "as if hand-dialed" property P2 demands is already true, on both
   surfaces, today.
4. **THE GAP:** `/color-pairs` renders nowhere on the global line. A palette
   the operator saves at the wheel is invisible in the COLORS modal and
   cannot be armed as a colour cue in QUEUE. And management is delete-only
   (EDIT mode) — no rename, no reorder.
5. **The sync defect:** `/color-pairs` deliberately shipped with **no WS
   type** (`_211`); the window fetches once on mount (`colors_window.tsx:
   710-732`) and deck windows never unmount (`display:'none'`) — a second
   iPad's save is invisible here until app restart.

### 1.4 Dead-code verdict — nothing to remove

- `/color-palettes` (the 23 tracked entries) is **load-bearing and read-only
  by design**: timeline cues reference the baby palettes
  (`playa_default.yaml`), `CueEditorSheet.tsx:219` consumes the list, and the
  library/store split is the `_242` ruling ("a pair is the degenerate
  palette" — one writable store, one curated library).
- `ParamPresetMenu.tsx` is per-channel pattern-param presets — a different
  feature entirely (`/mixer/param-presets`).
- `deck_hue_row.tsx` is a per-channel hue trim fader with no presets.
- The `_199` localStorage prototype scaffolding (`bm26_color_pairs_v1`) is
  already gone — zero AsyncStorage/localStorage colour hits in CaptainPad.

## 2. The ruling — expose and manage the store that already exists

**No new preset model. No new store. No new capture mechanism.** A "two-tone
colour palette" IS the existing schemaVersion-2 `/color-pairs` entry. The
wave is three additive moves:

### R1 — EXPOSURE (the operator's literal ask)

`ColorPickerModal` and `ColorQueueModal` gain a **SAVED PALETTES** section
beside the existing library grid:

- Same 2-column grid idiom the modal already uses (`PresetsTab`,
  `ColorPickerModal.tsx:367-397`); chips = `PresetIcon` wedge disc + name
  (unnamed fallback `263° / 192°` via the existing `presetLabel`).
- Saved section renders FIRST, library below, each under its own small
  header (`SAVED PALETTES` / `SHOW LIBRARY`) — two lists, one menu, never
  merged storage (D2).
- Tap = exactly the modal's existing `writeColors(p.c1, p.c2)`. Nothing new
  on the wire.
- QUEUE: the armed-slot state (`CPCControls.tsx:184`, pad-local ephemeral —
  unchanged) widens its TYPE to accept an id-less `{c1,c2,name?}` so a saved
  palette can be armed and fired as a colour cue (D4). Firing uses the
  existing direct `colorPalette1/2` POST (`:203-206`).
- Empty saved list → section absent; the modal renders **byte-identically to
  today** (the P2 unused-path property, pinned in §8).
- Recall-with-provenance (`ring`/`sel`/`scheme`/`base` restaging) remains a
  COLORS-window behaviour only — the global line applies the A/B pair, full
  stop. (The modal has no staging surface; restaging there would be invented
  scope. Noted as the one asymmetry, D9.)

### R2 — MANAGEMENT (in the COLORS window, per P1)

EDIT mode grows from delete-only to a per-chip action sheet:

- EDIT tap on a chip → op_dialog-idiom sheet: **RENAME** (opPrompt, same
  `''`-unnamed / `null`-cancel contract, swatches preview) · **MOVE UP** /
  **MOVE DOWN** (minimal reorder, no drag — D3) · **DELETE** (existing
  confirm path).
- All of it is client list surgery + ONE atomic whole-list
  `POST /color-pairs` — **zero new endpoints, zero schema change, no id
  minting**. The manager-family promotion (per-verb routes + minted ids, as
  `live_touch_preset_manager.js` does) would force a schemaVersion bump, and
  schemaVersion is a hard two-sided gate that darkens mixed-version iPads —
  P3 rules it out; escalate-only (D10).
- Failed POST → existing optimistic-revert path (`persistPairs`,
  `colors_window.tsx:734-746`) narrates and restores; never silent.
- New controls meet 44pt via hitSlop. The window's pre-existing sub-44pt
  debt (no `hitSlop` anywhere in the file today) is NOT this wave's to fix —
  existing controls untouched.
- Capture affordance: **unchanged** — `SAVE PALETTE` already exists where it
  belongs. The only capture-side edit is one caption line noting saved
  palettes also appear in the global COLORS/QUEUE menus (discoverability,
  text only).

### R3 — SYNC (the one engine slice)

New WS broadcast **`colorPairs`** + connect replay, closing the `_211` "no
WS type" gap now that two surfaces × two tabs × N iPads render the store:

- Register `colorPairs` in `ws_topic_routing.js` `TOPIC_BY_TYPE` →
  `TOPICS.CONTROL` (the table THROWS on unknown types — registration is
  mandatory, and `ws_topic_routing.test.js` pins it).
- Broadcast `{type:'colorPairs', action:'saved', schemaVersion:2, pairs}`
  after every successful `POST /color-pairs` (full list, family idiom).
- Connect replay in the `/ws/control` handler (`api_server.js:14465` block),
  own try/catch like every sibling ("never let a snapshot send break a fresh
  WS handshake"), `action:'replay'`.
- Extend the `ws_connect_replay` suite — the `_288` lesson: the last new
  topic broke it once already.
- Store/validator/routes byte-identical: same file, same `stateManager.save`
  atomic write, same whole-list semantics, same strict 400s, same
  500-on-future-schema GET, same drop-malformed-row-with-warn read (the
  `_242` deliberate divergence from the family's loud-read — kept, P2).
- Client: one shared **`colorPairs` read model** in `useEngineState.ts`
  (REST seed from `GET /color-pairs` + the WS topic), consumed by the modal
  AND the COLORS window. The window's fetch-once effect is retired **in the
  same W** — one reader, no second code path, no drift (this is a
  replacement-with-proof inside our own new plumbing, not a dead-code
  removal from the existing system).

### Storage ruling — scene-owned stands

Pairs stay in `states/<scene>/color_pairs_state.yaml`. This was ruled by the
operator at `_211` ("pairs are shared across iPads and localStorage is
out"), the entire StateManager universe is per-scene (zero global engine
state files exist), and no migration is needed because no shape changes.
Cross-scene promotion (a shared library across titanic/test_bench/…) is D5 —
offered, not scoped.

### Apply-while-a-daemon-drives

- **Global line:** stays UNGATED, exactly like today's library presets — the
  daemon overwrites at its next tick; the app-wide COLOR chip (docs/61 §4.4,
  shipped `_259`) names the driver. Adding a gate to the modal would change
  existing library-preset behaviour = a P2 violation; the engine-side write
  gate remains docs/61 D7, untouched.
- **COLORS window gallery:** keeps its existing `manualWriteGate` refusal
  with the kind-named sentence. No change to either behaviour; presets add
  no third arbitration path.

### Live Touch — deferred, by design

docs/70's COLOR panel (`_289`, unlanded) reimplements the docs/61 grammar
over the same wire; a later panel-side gallery can read the same
`GET /color-pairs` + `colorPairs` topic with zero engine additions. Flagged
as D6, not in `_297`.

## 3. The management UX in one paragraph (how dramatic: not very)

The operator's flow: dial a pair on the wheel → SAVE PALETTE → name it →
its wedge-disc chip appears in the COLORS window gallery AND in the global
COLORS/QUEUE menus on every iPad (WS). Tap EDIT in the gallery header →
chips gain the edit affordance → tap a chip → RENAME / MOVE UP / MOVE DOWN /
DELETE → DONE. Order in the gallery IS order in the global menus (one list,
`pairs[]` order, already the file's semantics). No settings maze, no new
windows, no drag choreography.

## 4. W-packages (one Opus lead, four Sonnets)

Sequencing: W1 ∥ W2 → W3 ∥ W4 → W5. Every W lands with its tests green.

- **W1 — client read model (Sonnet A).** Files: `hooks/useEngineState.ts`,
  `utils/api.ts` (+tests). The `colorPairs` frame: REST seed + WS topic +
  replay handling; typed against the existing `ColorPairWire`. Zero writes
  from this slice (grep-pinned).
- **W2 — engine sync slice (Sonnet B).** Files: `lib/api_server.js` (POST
  handler broadcast + replay block), `lib/ws_topic_routing.js`, tests
  (`color_window_engine_api.test.js` + `ws_connect_replay` + topic-routing
  suites). No daemon files, no validator/store diffs (§8 greps). ENGINE
  RESTART flagged to the coordinator.
- **W3 — global line exposure (Sonnet C).** Files: `ColorPickerModal.tsx`
  only (both modals + `PresetsTab` + armed-slot type live there; +tests).
  Saved section per R1; consumes W1. NO edits to `CPCControls.tsx`,
  `mixer.tsx`, `index.tsx`.
- **W4 — COLORS window management (Sonnet D).** Files: `colors_window.tsx`,
  `colors_window_logic.ts` (pure list-surgery helpers + tests),
  `utils/op_dialog.ts` ONLY if the action sheet needs an additive widening
  in op_dialog's own idiom (`_242` precedent: every existing call site
  untouched; anything more → escalate, P3). Switch the window to the W1 read
  model (retire the fetch-once effect). **Every wiring-test pin stays green
  — all 37** (`colors_window_wiring.test.ts`): no timers; memoized children
  keep the `const X = React.memo(function X` form with id/index-back
  `onPress`; `setSlot` dep array untouched; no new `const prevKind = kind;`
  (count-of-3 pin); no `mode:`/`followNote:` within 2 lines of a bare-stop
  call; stable-identity props for anything passed into `PresetChip`.
- **W5 — validation (Opus, no product files).** Offline walk against a
  scratch engine (HIGH port 17xxx, `--dest 192.0.2.9`, harness per
  `spawning_a_test_engine.md`). **Loopback rule (operator, 2026-08-16):
  never any loopback address other than `127.0.0.1`/localhost — a
  non-standard `127.0.0.x` fires a manual permission prompt and blocks the
  session; a second local listener gets a different PORT on `127.0.0.1`,
  and dead/black-holed destinations use `192.0.2.9` (TEST-NET-1) only.**
  The walk: save at the wheel → chip appears in the
  modal on a SECOND client via the topic (no reopen); rename/reorder/delete
  round-trip the file; QUEUE arms and fires a saved pair; kill/restart the
  engine → replay repopulates. Screenshot matrix (`~/tmp/fix_296/`, all
  inspected): ① modal deck with saved+library sections · ② modal mixer,
  same · ③ QUEUE armed with a saved pair · ④ gallery EDIT action sheet ·
  ⑤ rename round-trip · ⑥ empty-store modal byte-identical to a pre-wave
  capture · ⑦ refusal sentence on gallery load while TURNS drives ·
  ⑧ second-client live update. §8 grep gates. Full suites: engine + the
  complete CaptainPad suite + tsc + lint + web export + security check
  (public repo).

## 5. Acceptance gates (beyond per-W tests)

- The `_239` discipline: CaptainPad suite ends with an empty failing list
  against the session-start baseline; engine suite failures limited to the
  known environmental set.
- 44pt: every NEW interactive control ≥44pt via hitSlop (measure with the
  `_288` union gate tool where applicable).
- Two-iPad drift is CLOSED: prove a save on client A renders on client B
  without any window reopen, in both the modal and the gallery.
- P2 unused-path: with `pairs:[]`, a DOM/render diff of `ColorPickerModal`
  against pre-wave is empty.

## 6. §8 Byte-identical invariant list (P3 — all grep/test-pinnable)

1. `validateColorPreset` (`api_server.js:5995-6061`), `presetExtras`,
   `normalizeColorPairs`, `samePreset`, `buildPalettePreset` — zero diff.
2. Schema constants: `COLOR_PRESETS_SCHEMA_VERSION = 2`,
   `COLOR_PAIRS_MAX = 24`, name ≤24, ring 2..5, `sel[0] !== sel[1]` — both
   sides, zero diff.
3. `POST /color-pairs` request/response bytes; whole-list replace; strict
   400s; `GET` 500-on-future-schema; drop-row-with-warn read.
4. `paletteWritePayload`, `writeColors`, `pickPreset`, the one atomic
   both-slot `POST /param-center`, 33ms throttle, 700ms settle — zero diff.
5. The entire `/deck/color-autopilot` wire and `ColorAutopilot` daemon —
   zero diff (W2 touches only the POST-pairs handler + replay block +
   routing table).
6. `_242` dial constants and maths; `_211` gesture armor; `_217` zero-timer;
   all 37 `colors_window_wiring.test.ts` pins; `preset_icon.tsx`;
   `op_dialog` existing call sites.
7. `CPCControls.tsx`, `mixer.tsx`, `index.tsx`, `deck_hue_row.tsx`,
   `ParamPresetMenu.tsx` — zero diff.
8. Empty-store `ColorPickerModal` render — byte-identical (§5).

## 7. Decisions (each independently vetoable)

| # | Decision | Recommendation / default |
|---|---|---|
| D1 | WS topic vs fetch-on-open for sync | **Topic** (R3). Fetch-once already drifts visibly; family precedent + replay exist. Veto = W2/W1 drop out, W3 falls back to fetch-on-modal-open (drift remains in the gallery). |
| D2 | Saved section ABOVE the library in the modal | **Yes** — the operator curates it. |
| D3 | Reorder idiom | **MOVE UP/DOWN in the EDIT sheet** — "nice, not dramatic". Drag = later, only on ask. |
| D4 | QUEUE can arm saved pairs | **Yes** — "color cue" is in the order. Type widening only. |
| D5 | Cross-scene palette library | **Not now** — scene-owned is the operator's own `_211` ruling; promotion is a separate design if asked. |
| D6 | Live Touch gallery | **Defer** to a docs/70-family wave after `_289`; reads the same store + topic when it comes. |
| D7 | Library `hidden:` flag (baby palettes head the list — `_242` open item) | **Optional rider, default OUT.** Two-line change if the operator wants the picker cleaned. |
| D8 | Cap stays 24 | **Keep** — header already reads N/24; raising it is a two-sided constant bump, trivially done later. |
| D9 | Global-line recall of provenance presets applies A/B only (no restaging) | **Accept the asymmetry** — restaging is a COLORS-window concept (P1). |
| D10 | Manager-family promotion (ids + per-verb routes + server reorder) | **No** — forces a schema bump (mixed-version iPads go dark). Escalate-only. |

## 8. Collision / sequencing map

- **Hard blockers for `_297`:** the coordinator's git checkpoint, and
  `_295` (app-wide scroll arbitration) — `_294`/`_295` may edit
  `colors_window.tsx`/`hue_wheel.tsx` gesture code; same-file waves must not
  interleave (the docs/70 rule).
- **Soft sequencing:** run after the current storm lands (`_287` mixer W3,
  `_289`/`_291`/`_293` Live Touch) — no shared files (this wave touches
  neither `mixer.tsx` nor `touch_control.html`), but suite baselines, Metro
  caches, and the one-export-machine-wide rule all argue for a quiet tree.
- **Standing pins honoured:** `_282` memoization guards (W4 keeps all 37
  green); `_217` no-timer; docs/61 §6 "must not change" list; the `_268`
  budget and docs/66 pins are untouched (no Live Touch files).
- **Engine restart:** W2 batches into the restart already pending from
  `_283`/`_288`; never bounce the live stack for this wave alone.
- Reservations: this design lands as `_296`; the implementation wave is
  `_297` (already reserved at the tracker tail).
