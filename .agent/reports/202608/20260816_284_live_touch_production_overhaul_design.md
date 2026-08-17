# 2026-08-16 — Live Touch production overhaul DESIGNED: docs/70 (Fable)

**Agent:** Fable design agent (screenshot review + contract).
**Branch:** `feat/bm_readiness` working tree (design-only; zero product code
edits — one new doc, this report, tracker + dossier rows).
**Deliverable:** `docs/70_live_touch_production_overhaul.md` — the full
contract for the operator's three-item Live Touch order (spatial-first modes
+ renames; ambient backgrounds + deck-colour integration; per-scene preset
playlist), with W1-W5 packages, D1-D13 vetoable decisions, engine-vs-pad
split, and collision map.

## What was done

1. **Screenshot review (operator-ordered).** Exported a scratch CaptainPad
   dist to `C:/Users/TITANI~1/tmp/live_touch_overhaul/` (8.3 path; no other
   export was running), served on :7171, and captured the live-connected
   Touch Control tab (iframe → :6969 panel → :6968 engine, DISARMED, no
   engine writes) at iPad portrait 834×1194 and landscape 1194×834:
   `C:/Users/TITANI~1/tmp/live_touch_shots/{portrait,landscape}_{01_default,
   02_xy_mode,03_spatial_mode,04_spatial_fullscreen}.png` + per-pane crops +
   `*_mode_state.json`/`*_inventory.json` DOM dumps. Findings F1-F8 in
   docs/70 §1: portrait header/ARM-pill collision; wheel-as-hero priority
   inversion (pad below the fold, EFFECTS/GROUPS/PRESETS off-screen in
   portrait); XY MODE confirmed as the boot default (contradicting the
   order); cross-mode residue captions; three competing button vocabularies
   (bare-text DRAW/INK rails have no inactive chrome); config-sheet EFFECTS
   panel; raw telemetry in the audio rail; invisible PRESETS sliver.
   Fullscreen spatial is the one already-prod view — the design generalizes
   it rather than inventing a new language.

2. **Recon (3 parallel agents + own reading).** (a) UI surface: POOL→INVERT
   is a one-line label change (`touch_control.html:3093`) + help copy; the
   wire keyword `'pool'` and ordinal `data-dm="0"`/`DRAW_MODES[0]` are
   protocol across wire/engine/validator and preset encoding — rename OK,
   reorder forbidden; XY default is markup (`:2941`) + ordinal-reading
   predicates (`wire.js:~904`); nothing persists mode or pattern today; the
   128/129/130 set is pinned by
   `touch_control_wire_layers_contract.test.js:27-36`. (b) Colours/ambient:
   ONE global ColorAutopilot daemon (`api_server.js:6132`), mode-scoped
   wire + broadcast; an armed Live session cannot see daemon writes (private
   ParamCenter + shared-CPC source lock) → fan-out engine slice required;
   ambient truth is per-scene playlists (`ambient.yaml` 34 blessed entries);
   `PUT /layers/live_touch/pattern` already takes any slug but never applies
   entry defaults → small engine slice extends the body with
   `{playlist, entryId}`; modulations are deck-owned single-context — they
   don't follow (D5). (c) Persistence: Live Touch persists nothing
   engine-side; panel-side `bm26_touch_presets_v1` (v:3, populated, shipped)
   exists and its own comment says device-swap presets belong on the engine;
   house idiom = `states/<scene>/` sibling of SnapshotManager/
   ParamPresetManager via `writeFileAtomic`, autoSave-INDEPENDENT (live
   scene runs autoSave:false), WS broadcast + replay-on-connect.

3. **Contract written** — docs/70: §1 review, §2-5 ruled designs, §6 W1-W5
   (W1 production shell, W2 ambient backgrounds, W3 colour fan-out + cards,
   W4 preset playlist + migration, W5 the operator's proof bar), §7 D1-D13,
   §8 engine-vs-pad split (**engine restart REQUIRED for W2/W3/W4 slices —
   batch as one restart if possible**) + collision map (must NOT touch
   `colors_window.tsx`/`hue_wheel.tsx`/`colors_window_wiring.test.ts` —
   `_282` memoization pins them with source-text asserts; zero overlap with
   `_281` deck files, docs/69 mixer files, perf-mode wave files, shared
   playlist components), §9 constraints (transport pins verbatim, `_271`
   artifact gate unweakened, `_277` pair, docs/65/66 doctrine, Timeline
   authority untouched).

## Scratch hygiene

Scratch dist `C:/Users/TITANI~1/tmp/live_touch_overhaul/` + `npx serve`
on :7171 (killed at session end); capture script in the session scratchpad;
no engine spawned; live stack :6966-:6972/:6981 untouched; zero writes to
scenes/, states/, or any product file. No git operations.

## Follow-ups

- Opus lead session to implement docs/70 W1-W5 after tonight's landings
  rebase (W1 is pure panel work and can start immediately).
- Operator veto pass over D1-D13 (notably D4 source list, D6 instruments
  section, D8 legacy-dock scope, D10 migration).
- Bench-confirm the recon's source-lock analysis during W3 validation (it
  is code-derived, not yet observed live).
