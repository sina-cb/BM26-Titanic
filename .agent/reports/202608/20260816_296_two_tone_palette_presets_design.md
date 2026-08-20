# 20260816_296 — Two-tone palette presets designed: one store, every menu (docs/71)

**Agent:** Fable (design). **Branch:** `feat/bm_readiness` (docs only — no
product code, no engine run, no git ops, no dist writes).
**Operator order (verbatim):** *"the colors and color cue that we have, in
the deck and mixer, in the global line — see if you can make the color wheel
save 2 toned color palettes to that menu too. I want a nice way to manage
the preset 2 color swatches in our system."*
**Deliverable:** `docs/71_two_tone_palette_presets.md` — the full contract.
This report is the census evidence + the landing record. Implementation is
reserved as `_297` (Opus lead + 4 Sonnets), gated on the coordinator's git
checkpoint and the §5 sequencing.

## 1. What "that menu" turned out to be

The global line is ONE component mounted twice — `CPCControls.tsx` (row
`GLOBALS`, `:432`) at deck `index.tsx:1242` and mixer `mixer.tsx:3232`. Its
COLORS tile opens `ColorPickerModal`; its QUEUE tile ("the color cue") opens
`ColorQueueModal`, which reuses the same `PresetsTab` grid as a chooser for
a pad-local ephemeral armed slot. **The presets those modals show are only
`GET /color-palettes`** — the 23 tracked `config.yaml:356` entries
`{id,name,c1,c2}`, read-only, cue-referenced (baby palettes), cached at app
boot (`utils/api.ts:1371-1450`).

Meanwhile the colour wheel has saved named two-tone palettes since
`_211`/`_242`: `SAVE PALETTE` (`colors_window.tsx:1684`, `:961-997`) into
the **scene-owned** `GET/POST /color-pairs` →
`states/<scene>/color_pairs_state.yaml`, schemaVersion 2 (`c1`/`c2`
required; optional `name` ≤24, `ring` 2..5, `sel`, `scheme`+`base`
provenance), wedge-disc icons (`components/ui/preset_icon.tsx`), opPrompt
naming, duplicates-by-colours and the 24-cap refused before the prompt,
whole-list replace, strict two-sided validation
(`presetExtras`/`validateColorPreset`), **no WS type** (deliberate `_211`
scoping).

**The whole gap in the operator's sentence: the two stores never meet.**
Saved palettes render only inside the COLORS window; the global-line menus
show only the tracked library; a second iPad sees a save only on next
window mount (deck windows never unmount). Management is delete-only — no
rename, no reorder.

Dead-code verdict: **nothing to remove.** `/color-palettes` is load-bearing
(timeline cues, `CueEditorSheet.tsx:219`) and read-only by design;
`ParamPresetMenu` is pattern-param presets; `deck_hue_row` is a per-channel
hue trim; the `_199` localStorage scaffolding is already gone (zero
AsyncStorage colour hits).

## 2. The ruling (docs/71 §2)

**No new preset model, no new store, no new capture mechanism** — a
two-tone palette IS the existing schemaVersion-2 `/color-pairs` entry, and
both surfaces' apply paths already converge on the identical atomic
`POST /param-center` both-slot write (the "as if hand-dialed" property the
operator's freeze pin demands is already true). Three additive moves:

- **R1 EXPOSURE:** `ColorPickerModal`/`ColorQueueModal` gain a SAVED
  PALETTES section (PresetIcon chips, saved-first, library below, never
  merged storage); tap = the modal's existing `writeColors(c1,c2)`; QUEUE's
  armed slot widens its type so a saved pair can be armed and fired as a
  colour cue. Empty store → modal renders byte-identical to today.
- **R2 MANAGEMENT** (COLORS window, per pin P1): EDIT mode grows a per-chip
  action sheet — RENAME (opPrompt contract kept) / MOVE UP / MOVE DOWN /
  DELETE — all client list surgery + the existing atomic whole-list POST.
  Zero new endpoints, zero schema change, no id minting (manager-family
  promotion forces a schema bump that darkens mixed-version iPads —
  escalate-only, D10). New controls ≥44pt via hitSlop.
- **R3 SYNC** (the one engine slice): new `colorPairs` WS broadcast after a
  successful POST + connect replay in the `/ws/control` handler, registered
  in `ws_topic_routing.js` (the table throws on unknown types), family
  idiom (`live_touch_preset_manager` precedent), `ws_connect_replay` suite
  extended (the `_288` lesson). Client: one shared read model in
  `useEngineState.ts` (REST seed + topic) consumed by modal AND window; the
  window's fetch-once effect retired in the same W. **Engine restart
  required** — batches into the pending `_283`/`_288` restart.

Storage stays **scene-owned** (the operator's own `_211` ruling; zero
global engine state exists anywhere; no migration — no shape changes).
Apply-while-a-daemon-drives is unchanged on both surfaces: the global line
stays ungated exactly like today's library presets (docs/61 C5/D7 status
quo, app-wide COLOR chip names the driver); the gallery keeps its
`manualWriteGate` kind-named refusal.

## 3. Capture + management UX (two sentences each)

**Capture:** unchanged — SAVE PALETTE already sits in the Saved-palettes
header where pin P1 wants it; the only edit is one caption line saying
saved palettes now appear in the global COLORS/QUEUE menus. A saved chip
appears on every iPad's global line via the topic, so "save at the wheel,
use it anywhere" is one gesture.

**Management:** EDIT in the gallery header, tap a chip, pick RENAME / MOVE
UP / MOVE DOWN / DELETE from an op_dialog-idiom sheet, DONE — gallery order
IS global-menu order (one list, `pairs[]` order). No settings maze, no
drag choreography, no new windows.

## 4. W list (docs/71 §4)

W1 client read model (`useEngineState.ts` + `api.ts`) ∥ W2 engine sync
slice (`api_server.js` POST broadcast + replay, `ws_topic_routing.js`,
suites) → W3 global-line exposure (`ColorPickerModal.tsx` only) ∥ W4 COLORS
window management (`colors_window.tsx` + `colors_window_logic.ts`, all 37
wiring-test pins green, op_dialog widened only in its own idiom) → W5 Opus
validation (offline scratch-engine walk incl. second-client live update +
replay-after-restart, 8-shot matrix, byte-identical grep gates, full suites
+ security check).

## 5. Decisions + sequencing

D1 WS topic (REC yes) · D2 saved-first in the modal (yes) · D3 move-up/down
not drag (yes) · D4 QUEUE arms saved pairs (yes) · D5 cross-scene library
(not now) · D6 Live Touch gallery (defer, reads the same store later) · D7
library `hidden:` flag for the baby palettes (optional rider, default OUT)
· D8 cap stays 24 · D9 global-line recall applies A/B only, no restaging
(accept) · D10 manager-family promotion (no — escalate-only). Full table
docs/71 §7.

**Sequencing:** hard blockers for `_297` = the coordinator checkpoint +
`_295` (scroll arbitration may edit `colors_window.tsx`/`hue_wheel.tsx` —
same-file rule). Soft = after `_287`/`_289`/`_291`/`_293` (no shared files —
this wave touches neither `mixer.tsx` nor `touch_control.html` — but suite
baselines and the one-export rule argue for a quiet tree). Standing pins
honoured: `_282` (all 37 guards), `_217` no-timer, docs/61 §6, `_242` dial,
`_211` armor. Operator pins P1-P3, the dead-code ruling (nothing qualified),
and the checkpoint gate are written into docs/71 §0 verbatim-intent.

## 6. Census provenance

Three Opus read-only census agents (global-line surface / wheel + `_282`
pins / persistence family + sequencing), findings cross-checked against
first-hand reads of docs/61, docs/70 §4-5, the `_211`/`_242` tracker blocks,
and the tracker's reservation note. No source file was modified; no server
started; the live :6966-:6972 stack untouched.
