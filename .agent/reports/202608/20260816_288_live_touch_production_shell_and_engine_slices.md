# `_288` — Live Touch: the production shell ships, and all three engine slices land

**Agent:** Opus implementation lead + 4 Sonnet implementers.
**Branch:** `feat/bm_readiness` working tree (uncommitted, per standing rule).
**Contract:** `docs/70_live_touch_production_overhaul.md` (design report `_284`).
**Scope delivered:** W1 complete; the W2/W3/W4 **engine** slices complete.
The W2/W3/W4 **panel** sides are NOT built — see §7, stated plainly.

> **ENGINE RESTART REQUIRED** — three slices changed `marsin_engine/`. The
> operator's live `:6968` runs the old code until it bounces. A restart was
> already pending from `_283`; **these batch into that same restart.**
> **NO CaptainPad rebuild is required** (see §2, contract correction 1).

---

## 1. What the operator asked, and what changed

Order item 1 (the shell) is **delivered**. Items 2 and 3 have their engine
foundations delivered and their panel surfaces still to build.

Measured against the F1-F8 findings in `docs/70` §1, at both docs/66
acceptance viewports, live-connected through the real CaptainPad frame:

| | before | after |
|---|---|---|
| Proof-matrix checks passing | **1 / 14** | **14 / 14** |
| Portrait controls failing the 44pt hit region | 40 / 146 | **0 / 146** |
| Landscape controls failing the 44pt hit region | 81 / 146 | **0 / 146** |
| Portrait title width | overlapped ARM | **129px, clear** |
| Boot mode | `XY MODE` | **`SPATIAL`** |

Screenshots — before `C:/Users/TITANI~1/tmp/live_touch_shots/`, after
`C:/Users/TITANI~1/tmp/live_touch_impl/shots/after/`
(`portrait_01_default.png` 834×1194, `landscape_01_default.png` 1194×834,
plus `*_probe.json` geometry dumps and `findings.json` per run).

---

## 2. Three corrections to the contract (reported, not hidden)

**1. `docs/70` §2.3 misattributes F1.** It rules the portrait header
collision "a layout bug in the CaptainPad tab header
(`app/(tabs)/touch_control.tsx` chrome)". That file contains **no header
chrome at all** — only the iframe surface, `PlanLockBanner` and an error
toast. The colliding header is `docs/ui/touch_control.html:2754`.
**Consequence: W1 is 100% panel-side, needs no CaptainPad rebuild and no
native rebuild** — the sim serves it from disk, so a panel reload picks it
up. This is strictly better than the contract assumed.

**2. `PUT /layers/live_touch/pattern` has no 409/revision precondition.**
`docs/70` W2 acceptance says "revision-race 409 behaviour unchanged" — there
is none to preserve. The route is write-wins and `sessionRevision` in the
response is emit-only telemetry. No precondition was invented.

**3. Every one of `ambient.yaml`'s 34 entries has `label: null`.** `docs/70`
§3.2 specifies a picker "listing ambient playlist entries **by label**".
That is not possible as written; the picker (unbuilt, §7) must fall back to
the pattern name. Flagged for whoever builds it.

---

## 3. W1 — the production shell (panel only, no restart)

All eight work items landed. `docs/ui/touch_control.html`,
`docs/ui/touch_control_wire.js`.

- **SPATIAL boots, via `data-mode`.** Mode identity was **ordinal in five
  places**, not the two the contract names — `wire.js spatialMode()`,
  `spatialModeActive()`, `padIsDrawing()`, the DRAW-rail `sync()`, plus the
  `selectable()` writer. All five now read
  `button[data-mode="spatial"]`. Toggle order is SPATIAL, EFFECT CONTROL.
- **POOL → INVERT**, label + `title` + `DRAW_HELP` copy + stale design
  comments. `data-dm="0"` and `DRAW_MODES[0] === 'pool'` are byte-identical;
  TRAIL is still the lit default.
- **Cross-mode residue deleted** — both dead captions gone, and the
  non-owning mode's rails now **collapse** rather than render as four greyed
  buttons.
- **F1 fixed** (root cause in §5).
- **44pt two-tier button system** — bare-text DRAW/INK/TAKE rails gained real
  pill chrome in every state; hit regions closed to zero failures.
- **BRUSH cluster** — six always-open chip rows collapse behind one summary
  row (`35% · 90% · 0.5 s · 35% · 72%`), expanding in place.
- **PRESETS rail tab** — rotated vertical text → a labeled pill with its dot.
- **Audio rail** — `micLow`/`micDomFreq1` → `LOW`/`DOM1 FREQ` (the `lab`
  field had been carried in `METER_BARS` all along as dead code), Hz units on
  frequency cards, real label on the `+N` chip. Presentation only; no
  analysis, registry or normalisation maths touched (D13).

**Bonus fix:** the W1 implementer found and fixed a pre-existing bug in
`chipsFor()` where tapping a chip never updated its own readout text.

---

## 4. The engine slices (ALL require the restart)

**W2 — blessed ambient backgrounds.** `installLiveTouchPattern` takes an
optional entry; `playlistManager.applyEntryDefaults` is applied **between**
code defaults and CPC — the same precedence as a deck stage. `PUT
/layers/live_touch/pattern` accepts `{pattern, playlist?, entryId?}`, with
`playlist`/`entryId` all-or-nothing. The entry is resolved **before** any
channel mutation, so a bad reference cannot leave Live staged at code
defaults. Unknown playlist / unknown entry / `_missing` entry → 400, loud, no
fallback. The live channel's **private** ParamCenter is passed as the 5th arg
(the shared one would mis-gate CPC-owned exports).
Tests: `tests/effects/live_touch_background_entry.test.js` — **6/6**.

**W3 — colour fan-out.** An armed Live session could not see the deck colour
daemon at all: ARM source-locks the shared CPC to `'api'`, so every
`'colorAutopilot'` write was silently swallowed for the whole session while
the daemon kept broadcasting. `writeColorPaletteParams` now **also** writes
the session's private ParamCenter, which carries no source lock. The shared
write and its lock semantics are untouched. The private centre is read
**fresh every call** — it is rebuilt on every arm/disarm, so a cached
reference would write into a dead object. Confirmed there is exactly one
apply path (all four `ColorAutopilot` call sites route through the injected
`applyParamsFn`). Failure surface is a loud `console.warn`, never a throw:
this runs ~25 fps from a fire-and-forget caller, and a throw from exactly
that shape killed the live engine in `_253`.
Tests: `tests/effects/live_touch_color_fanout.test.js` — **3/3**, including
the bench-confirmation `docs/70` §4.2 explicitly asks for (the source-lock
analysis was code-derived; it is now observed) and an arm→disarm→re-arm case
proving no stale reference.

**W4 — preset playlist.** New `lib/live_touch_preset_manager.js`: single
ordered file `states/<scene>/live_touch_presets.yaml`,
`{schemaVersion, entries}`, every mutation through
`StateManager.writeFileAtomic`, **never** via `saveAllState` (the live
titanic scene runs `autoSave: false` — verified in its `settings_state.yaml`
— so anything routed that way would silently never write). Corrupt store →
loud `LIVE_TOUCH_PRESET_STORE_MALFORMED`; a **missing** file is the one
benign empty case and is distinguished explicitly. REST at
`/layers/live_touch/presets`, `liveTouchPresets` WS broadcast, replay on
connect. `state` is stored verbatim and never interpreted.
Tests: `tests/state/live_touch_presets.test.js` — **7/7**, including the
engine-restart round-trip the old localStorage store could never pass.

**Correction to the contract:** `ParamPresetManager` is one-file-per-preset,
filename-ordered, with **no rename or reorder**. It was not mirrored
structurally — only its atomic-write discipline and fail-loud posture.

---

## 5. F1's real root cause (the contract only said "fix the header")

At `≤1120px` the topbar becomes a 6-column grid with `.brand` in a
`minmax(120px, auto)` track; at `≤900px` `.brand h1` was inflated to
`1.5rem`. `.brand h1` carries `overflow:hidden; text-overflow:ellipsis`, but
the **unclassed wrapper `div`** between `.brand` and `<h1>` kept its default
`min-width:auto`, so it rendered at full max-content width and spilled across
the `arm` area. The landscape breakpoint has fixed exactly this since docs/66
W4 (`.brand > div { min-width: 0 }`); portrait never received it.

The first fix over-corrected by copying landscape's `max-width: 70px`, which
rendered the wordmark as **"TO…"** — `text-overflow: ellipsis` truncates the
`<h1>`'s content *as a whole*, and `#44` lives in a span **inside** it, so an
over-tight clamp eats the entire wordmark. Final value is a **measured
budget**, not a copied number: in the embedded frame (722px wide, not 834 —
the CaptainPad rail takes ~112px) brand starts at x=29 and ARM at x=199.9, so
`max-width: 158px` clears ARM with gap and leaves the `<h1>` 129px.

---

## 6. Two hazards caught mid-flight

**A live inversion, repaired.** The W1 implementer reordered the toggle
(SPATIAL to index 0) and converted only three of the five ordinal sites,
leaving `wire.js:1489` and `html:4449` reading `btns[1]` for ~10 minutes.
With SPATIAL at index 0, `btns[1]` resolved to EFFECT CONTROL — so
`spatialMode()` returned **false while the UI showed SPATIAL lit**, inverting
every mode-gated behaviour. `docs/ui/` is served live from disk to the
operator's iPad, so this was a live breakage. The lead fixed both sites
directly rather than wait. **Standing lesson: on a live-served file, a
behavioural change and every one of its readers must land in the same short
window.**

**The acceptance gate was measuring the wrong thing.** The harness's 44pt
check initially used `getBoundingClientRect()`, which **cannot see an
`::after` hit-region overlay** — the very technique the brief mandated. It
would have scored a correct fix as a failure and pushed the implementer into
growing real boxes, which is precisely the `_268`-pinned `xyPad.clipBottom`
regression that docs/66 W4 P4 already hit and reverted. The gate now measures
`union(border box, ::after overlay)`, per docs/66 §2.1 as written.
Cardinal-point `elementFromPoint` sampling was also tried and **rejected**:
it silently folds in a second property (are neighbours ≥44px apart) that
dense chip rows can never satisfy, producing unreachable failures.
The fix is confirmed correct by construction: hit failures went 40→0 and
81→0 **while the box-only census stayed flat at 95/136** — no real box grew,
so the pad budget is intact.

---

## 7. NOT DONE — the panel sides of W2, W3, W4

Stated plainly rather than implied. The engine is ready for all three; the
panel surfaces are unbuilt:

- **W2 panel** — the BACKGROUND/INSTRUMENTS picker. Engine accepts
  `{playlist, entryId}` today. Must label entries by **pattern name**
  (correction 3). `touch_control_wire_layers_contract.test.js:27-37` hard-pins
  `['128','129','130']` and must be updated **deliberately** when it lands.
- **W3 panel** — the three docs/61-grammar colour cards, deleting the client
  Scriabin table, and **LEGACY COLOR docked by default (D8)**. Note: D8 is
  what actually resolves **F2** (the wheel is still the hero and the pad is
  still the tenant in portrait) — F2 is therefore still open.
- **W4 panel** — the presets playlist UI and the one-time
  `bm26_touch_presets_v1` migration (D10).

**F6** (the EFFECTS config sheet) is also still open; it is described in
`docs/70` §1 but not scoped into any W-package.

---

## 8. Gates

| Gate | Baseline | After |
|---|---|---|
| Proof harness, both orientations | 1/14 | **14/14** |
| CaptainPad vitest | 2327 pass / 6 skip / 0 fail | **2336 pass / 6 skip / 0 fail** |
| CaptainPad `tsc` | 0 errors | **0 errors** |
| Engine HTML-parsing contract (×3) | 32/32 | **32/32** |
| Simulation panel suites (×4) | 68 pass / 1 fail | **68 pass / 1 fail** (same pre-existing failure, `touch_control_pixel_views.test.js:158`) |
| `tests/effects/live_touch_*` | — | **21/21** |
| `tests/state/*` | 121 | **128/128** |
| Colour-autopilot suites (×3) | — | **122/122** |
| `tests/e2e/ws_connect_replay` | 5/5 | **5/5** (see below) |
| Security scan | PASS | **PASS** |

**One regression found and fixed by the lead:** W4's new WS topic broke
`tests/e2e/ws_connect_replay.test.js`, which classifies every replayed topic.
`liveTouchPresets` was added to `TOUCH_CONTROL_WIRE_CONSUMED_TYPES` (the
panel's own socket reads it, not CaptainPad's `useEngineState.ts`) — back to
5/5.

**Pins verified unchanged:** `touch_control_theme.js` md5
`0418472d42f81f887d822c4020d51fc3`; `buildTransport` ×2 and
`__captainpadDeliver` ×2 in theme; `captainpad_embed` 1×html + 1×theme;
`DRAW_MODES[0] === 'pool'`; `data-dm` values `0 / 0.33 / 0.66 / 1` in order.

**Known flake (not caused by this wave):** running the whole
`tests/effects/live_touch_*.test.js` glob in one `node --test` invocation is
intermittently ECONNREFUSED-flaky from ~7 concurrent real engines; it
reproduces identically without any of this wave's files. Per-file runs are
all green (21/21).

---

## 9. Deviations accepted

- **W2 added a `localControls` field to the PUT response.** `GET
  /layers/live_touch/exports` cannot report current slider values
  (`wasmHost.getExports()` returns only `{id, kind, name}`), so the
  acceptance assertion was otherwise unwritable. Additive, inside the owned
  route, reusing the already-tested `playlistManager.captureDefaults`.
- **W4 deliberately did NOT add the `rejectIfPerformanceMode` gate** that
  `ParamPresetManager`'s mutation routes carry, on the grounds that `docs/70`
  frames a preset as a staging document usable during a live show. A
  conscious divergence from the sibling idiom; flagged for operator veto.
- **W3's failure surface is a warn, not a throw** — justified by `_253`.

## 10. Scratch hygiene

Scratch dist `C:/Users/TITANI~1/tmp/live_touch_impl/dist` served on `:7172`
(one export machine-wide, checked first); `CaptainPad/dist` untouched
(verified). No scratch engine was spawned — the engine slices were tested by
their own harnesses with redirected state dirs and black-holed sACN. Live
stack `:6966-:6972`/`:6981`/UDP 5568 never bound or written; every panel
capture ran DISARMED. New durable tool:
`simulation/agent_tools/live_touch_overhaul_shots.cjs` (the 44pt audit the
repo did not have — docs/66's "audit" was hand measurement in CSS comments).
No git operations.
