# now.md — State of Play

> Updated 2026-08-17. Keep this file under one screen; history belongs in
> project dossiers and reports.

## Hot

- **Live Touch is offline-green; physical-iPad acceptance remains open**
  (`01a011f5-2ed6-72a1-bd3b-52613b5e8cfd`, report `_311`). Pattern switching,
  instrument geometry, false-brush removal, Color, 16-slot Performance Effects,
  non-replacing overlays, TAKE REC/PLAY/LOOP/CLEAR, and authoritative 964/964
  Spatial map parity are validated. DISARM deactivates active overlay slots and
  confirms zero active effects before releasing the lease; it never calls the
  retired `/movement-rate` route. Focused cleanup 36/36, TAKE 10/10,
  transport/lift 9/9, parity 17/17, ARM brush 7/7, projection 55/55, overlay
  cleanup 16/16, aggregate 72/72; independent engine/session 40/40 and spatial
  stroke 9/9 pass. Restart the engine and reload CaptainPad before the physical
  ARM/pattern/effect/TAKE/Spatial/DISARM smoke.
- **Timeline lease hardening is complete pending physical-native smoke.** The
  exact armed-owner matrix passes; Timeline 450/450, CaptainPad 76/76, adjacent
  lease APIs 5/5, independent validation, and inspected AFTER captures are green.
- **Timeline priority over Live Touch is automated-green; physical smoke open.**
  Exact Timeline mutations now force-clear and confirm ARM/source-lock release,
  hold authority through response, then dispatch once; preview stays ownerless. Real API matrix 1/1,
  adjacent lease/takeover/deadman 10/10, gate/classifier 10/10, CaptainPad 62/62,
  TypeScript, and lint pass. Report `_317`.
- **Mixer adaptive uniform channels are automated-green.** All visible cards
  share one width, clamped from today's minimum to 50% of available row width;
  focused 87/87, full CaptainPad 2555 pass/6 skip, lint, and web export pass.
  Honest 2/3/overflow screenshots need an authorized isolated scratch stack or
  a later physical smoke because the read-only live stack has zero channels
  (report `_318`).
- **Deck/Mixer palette-library polish is automated-green; visual smoke open.**
  The shared `ColorsWindow` and picker now share bounded Fabric/Yoga layout
  styles, saved-palette delete is confirmed and authority-first, and starred
  curated items remain immutable. A stale stopped Crossfade ring can no longer
  override latest selected A/B on the next run; active Crossfade stays
  engine-authoritative. Focused palette/layout/crossfade tests 354/354,
  TypeScript, and touched ESLint pass (report `_319`). Deck/Mixer iPad/web
  visual smoke remains open; no service was started for a synthetic capture.
- **Color-wheel five-slot consistency is fixed.** Repeated scheme hues retain
  semantic values and slot order but receive deterministic collision-only
  display positions, leader lines, and matching hit targets. Marker 4/4,
  shared Color core/logic 305/305, TypeScript, and lint pass.
- **Crisp promotion and playlist retirement are operator-approved, closed, and
  archived.** Sources
  01/02/03/06/08/10 are in both 53-entry Ambient playlists for both scenes;
  scene pairs are byte-identical. The dedicated Crisp playlist/gallery is
  retired. Pattern 03 uses Local Speed 0.20 and a 37.68 s cycle at global 64.
- **Effects review is complete.** `_310` is a verified design/gallery package,
  not product implementation. Direct Kick Punch and Hi-Hat Sparkle inputs are
  hard-coded to zero; shared freshness and musical phase contracts must precede
  an audio-effects implementation wave.
- **Baby is Claude-owned.** The Codex Baby task is paused and archived. Do not
  touch Baby files until Sina explicitly returns ownership.

## Canonical model language

- `docs/TITANIC_MODEL.md` is current and validated: LEFT=`X+`, RIGHT=`X-`,
  FRONT=forward end, BACK=rear end, UP=`Y+`.
- Some legacy runtime `LEFT`/`RIGHT` names are physically inverted relative to
  operator language. The compatibility hazard is documented; runtime geometry
  was not flipped.
- The reference contains 24 named regions, whole-model recipes, the missed-wall
  acid test, and a pattern-author preflight. Census 24/24 and links 26/26 pass.

## Completed / inactive

- Crisp promotion/retirement passed 36/36 parameter truth, seam, coverage,
  TE-sign, colour/lane, audio, gallery, and performance gates. Sina approved
  the final Ambient gallery; the task is archived.
- Titanic model documentation is validated and **closed/archived**. Its
  canonical LEFT/RIGHT/FRONT/BACK guidance remains active documentation, but
  there is no continuing agent workstream.
- Previous Live Touch ARM audit, Ambient, DOM Dancers, Pattern Manager, and
  native iPad layout tasks are archived.
- Native Audio configuration restoration is complete, physically accepted,
  and archived. Fabric/Yoga collapsed an auto-height meter row around `flex: 1`
  signal columns; intrinsic-width roots restore lower-card flow. Report `_316`.
- Deployment hardening is locally complete: secure secret provisioning,
  `.git` exclusion/ACL handling, `--no-launch`, and verified shortcuts/icons.
  No remote deploy was run by an agent.
- Commit audit is complete; nothing is staged. Exclude
  `marsin_engine/states/**` and
  `simulation/scenes/test_bench/bench_mirror_state.yaml` from any checkpoint.

## Operator gates

1. Restart the updated engine and run the Live Touch physical-iPad smoke.
2. Include Timeline-preempts-Live-Touch in that same physical smoke.
3. Claude Baby handoff and review.
4. Exterior deployment only when Sina chooses to run it.
6. Git checkpoint only on explicit operator instruction, after staged security
   and touched-subsystem gates.

## Coordinator reporting contract

- Every five-minute update lists every tracked `[Sub-Agent]`, including
  `No material change` when unchanged.
- Every listed workstream includes `Needed from Sina:`. Routine coordination
  remains agent-owned and reports `Nothing right now`.

## Durable pointers

- Master program: `../projects/bm26_show_readiness.md`
- Live thread tracker: `../memory/bm_readiness_thread_tracker.md`
- Pattern blessing: `../projects/pattern_curation_and_playlist_blessing.md`
- Titanic model: `../../docs/TITANIC_MODEL.md`

No agent is authorized to commit, push, arm the rig, drive live sACN, or
start/stop the operator's stack without explicit permission.
