# 20260619_2 — Test Auto-Patch + Clear All Patches (Controller Mapping pane)

**Agent:** developer · **Branch:** `dev/claude/views_rehaul` (committed, NOT pushed)
**Why:** The titanic rig ships with ~0 DMX-patched fixtures and (until recently)
unpatched LED strands, so it can't stream/visualize without tedious manual
patching. The operator asked for a one-click TEST patch utility plus a wipe.

These are TEST/smoke utilities — a fast way to get the whole rig streaming and
lighting in the sim/engine. They are NOT production hardware-accurate
addressing; real addressing stays the per-fixture Controller Mapping flow.

---

## What shipped (files + functions)

### `simulation/src/dmx/controller_registry.js` (registry logic — source of truth)
- **`testAutoPatch(registry, dmxConfigs, strands, pins)`** — patches the whole
  rig into the registry, in place. Returns
  `{ created[], dmxPatched, effectsPatched, strandsPatched, universesUsed[] }`.
  Throws loudly if anything is left unmapped (codex P0).
- **`clearAllPatches(registry)`** — strips every chain entry (fixtures, strands,
  gaps) from every port of every controller. Returns
  `{ entriesCleared, freed[] }`. Controllers + ports are KEPT; only bindings go.
  (Distinct from the retired `auto_patcher.js` `clearAllPatches`, which mutated
  per-fixture patch fields under the old non-registry model.)
- Internal helpers: `firstUsableController`, `firstEmptyOrNewPort`, plus the
  `TEST_DMX_CONTROLLER_*` / `TEST_LED_CONTROLLER_*` defaults.

### `simulation/src/gui/controller_map_editor.js` (the Controller Mapping pane UI)
- Imports `testAutoPatch`, `clearAllPatches`.
- New `.cm-test-tools` row directly under **+ Add Controller** holding two
  buttons: **⚡ Test Auto-Patch** and **🧹 Clear All Patches**.
- `runTestAutoPatch()` — snapshot → `testAutoPatch` → `recomputeAndMark()`
  (projects into patches.yaml, marks dirty, debounced auto-save) → re-render →
  undo toast. Failures surface as a loud red toast (no silent partial patch).
- `runClearAllPatches()` — danger confirm modal (matches controller/port
  deletes) → snapshot → `clearAllPatches` → reproject → undo toast.

### `simulation/style.css`
- `.cm-test-tools` (flex row), `.cm-test-autopatch` (primary tint). Clear reuses
  the existing `.cm-danger` style. All via theme `color-mix` tokens (UI design
  rule: tokens not literals).

### `simulation/tests/controller_registry.test.js`
- 9 new unit tests (see below).

---

## Auto-patch mapping scheme (TEST, deterministic)

Controllers: REUSE the first valid-IP controller of the right type; else CREATE
a default (`TEST DMX` @ 10.0.0.1, `TEST LEDs` @ 10.0.0.2) — surfaced loudly in
`created[]` and a `console.warn`.

- **DMX fixtures (non-effect):** packed footprint-after-footprint in iteration
  order, starting at the first port's universe (U2…), ch 1. Each universe is one
  port (ports are pure cable topology; the port carries the universe). When the
  next fixture's footprint would cross channel 512, open the next port (next free
  universe) and reset to ch 1 — a fixture never straddles a universe. Footprints
  are REAL (definition registry): UkingPar=10, ShehdsBar=119, VintageLed=33.
- **Global effects (fog/haze/horn/fire):** pinned at their `config.yaml`
  `global_effects` address on the effects universe U1 (same as the panel's
  "+ effects"). A type with no pin lands at `at:0` and the projection flags it
  loudly — never silently dropped.
- **LED strands:** bound in order onto one port of the LED controller;
  `computeLedProjection` lays them out as sequential per-pixel patches
  (stride × ledCount, wrapping universes at 512).

Already-mapped fixtures are left untouched; only the currently-unmapped are
patched (re-running tops up). After patching, a completeness sweep THROWS if
any fixture/strand is still unmapped.

## How Clear-All works

Iterates every controller → every port → truncates `port.chain` to empty,
counting removed entries and collecting freed names. Controllers/ports remain so
the topology stands; the projection then reports every fixture unpatched (the
loud unpatched markers apply). A loud `console.warn` + toast names the counts.
The active→inactive transition in the panel keeps working unchanged (controllers
still exist, so `registryIsActive` stays true and fields reproject to unpatched).

---

## Test / functional results (numbers)

**Unit tests** — `cd simulation && npm test`: **106 pass / 0 fail** (was 97; +9):
- creates controllers + patches all DMX (0 unmapped), sequential addrs 1/11/21
- wraps universes at 512 by footprint (4×ShehdsBar on U2, 5th → U3:1)
- pins global effects at config.yaml addrs on U1
- binds all LED strands to an LED controller (S2 @ 201 after S1 50×4)
- DMX+LED together, zero unmapped
- reuses an existing usable controller (no duplicate create)
- loud: never leaves anything unmapped
- clearAllPatches unpatches everything (mapped==0 after, ports kept)
- clearAllPatches on empty registry is a no-op

**Headless functional harness** (`~/tmp/test_auto_patch_harness.mjs`, real
titanic scene, no browser): **PASSED**
- Loaded titanic: **70 DMX fixtures** (ShehdsBar 20, UkingPar 34, VintageLed 16)
  + **16 LED strands**.
- Test Auto-Patch: created TEST DMX + TEST LEDs; **70 DMX patched, 16 strands**,
  universes **U2–U9**, **0 violations**, **0 out-of-range**. Samples:
  `Generator 1` (ShehdsBar) → U2:1, `Generator 2` → U2:120, `Generator 3` →
  U2:239; `Left_Front_Left` → U9:1 ×40px RGBW.
- Clear All: removed **86 entries**, mapped → **0**, controllers kept (2),
  projection 0 DMX / 0 LED patched.

**Browser smoke** (puppeteer, `?scene=titanic`, screenshots in `~/tmp/`):
- Both buttons render: "⚡ Test Auto-Patch", "🧹 Clear All Patches".
- After Auto-Patch: 2 controllers, 86 mapped entries, header **"✓ fully patched"**.
- After Clear (through confirm modal): 0 chain entries, header **"Unmapped: 70 ⚠"**.
- No console errors from this code. The only console errors were unrelated:
  WebSocket to the engine at :6968 (engine not running in this smoke) and a
  PatchManager **universe-mismatch notice** (the sim's subscribed sACN universe
  list lacked the newly-allocated U7/U8 — exactly the loud guidance it's built
  to emit; see the checklist).

**Auto-checks** (`.agent/00_gol/04_sim_auto_checks.md`): `git diff --check --
simulation` pass; `node --check` on all touched files pass; `npm run check` pass.

**Residue:** sim smoke wrote nothing tracked (save POSTs target :6970, which was
down at capture; `scenes/titanic/controllers.yaml` unchanged). Working tree =
only the 4 source files. `~/tmp/` harness + screenshots are gitignored scratch.

---

## CHECKLIST for the 2 independent test agents

Bring up the sim on the titanic scene and open **🎛 Controller Mapping**
(`window.toggleControllerMapPanel()` or the panel toggle).

1. **Before (dark/unpatched):** titanic shows ~70 DMX fixtures unmapped, 16
   strands unmapped. Toggle "⚪ Unpatched Highlight: ON" → fixtures tint red.
   Screenshot the panel header (should read `Unmapped: 70 ⚠` / strands too) and
   the 3D view (dark / red-tinted).
2. **Click ⚡ Test Auto-Patch:**
   - A `TEST DMX` (10.0.0.1) and `TEST LEDs` (10.0.0.2) controller appear
     (unless usable ones already existed — then it reuses them; check the toast).
   - Panel header flips to **✓ fully patched**; Unmapped tray says
     "✓ every fixture is mapped" / "✓ every strand is mapped".
   - DMX fixtures show sequential addresses (U2:1, U2:120, …, wrapping to U3+);
     strands show `U…:… ×Npx RGBW`. Screenshot the panel.
   - **0 violations banner.** If any red violation appears, that's a fail.
3. **Live engine smoke (prove streaming + sim lights the whole rig):**
   - The test universes go up to ~U9. The sim's subscribed sACN universes must
     include them, or you'll see a loud "UNIVERSE MISMATCH" PatchManager error
     (this is expected guidance, not a bug). Fix via **⚡ Lighting Engine → 📡
     sACN Settings → Subscribed Universes**: add the missing universes and
     restart the sim. (Follow `.agent/01_skills/05_full_stack_smoke.md`; start
     the engine with `--model titanic`.)
   - With the engine streaming a pattern, the exterior + strands should light.
     Screenshot two frames showing animation; confirm sACN IN monitor Connected.
4. **Click 🧹 Clear All Patches → confirm the danger modal:**
   - Toast: "Cleared N patch(es) — N fixture(s) now unpatched" (N≈86 on titanic).
   - Panel header back to **Unmapped: 70 ⚠**; controllers/ports remain but empty;
     Unmapped tray re-lists every fixture/strand. With Unpatched Highlight on,
     the rig tints red again. Screenshot the panel + 3D view.
5. **Undo + Save:** the Clear toast offers Undo (restores the patch); verify it.
   Then run Test Auto-Patch again and hit 💾 Save Configuration — confirm
   `scenes/titanic/controllers.yaml` gains the TEST controllers and
   `patches.yaml` gains the projected universes/addresses (round-trips to the
   engine model).

**Pass criteria:** auto-patch → 0 unmapped, 0 violations, engine streams and sim
lights the full rig; clear-all → back to fully unpatched with controllers kept;
no uncaught console errors attributable to the patch tools.
