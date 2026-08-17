# `_283` — CONFIG leaves the performance UI; the offline exit becomes the escape hatch; playlist switching opens on deck + mixer

**Date:** 2026-08-16 · **Branch:** `feat/bm_readiness` (uncommitted, commits
operator-gated) · **Agent:** Opus implement+validate

## The two operator asks (verbatim)

1. *"please hide the config from the performance UI — just make sure the EXIT
   PERFORMANCE MODE is possible using the UI even if the engine is not
   connected, so I can go into edit and go to config to select a new server or
   sth"*
2. *"in the performance mode, allow playlist changing in the deck and mixer
   too."*

Ask 1 carries a hard gate: hiding CONFIG is only allowed **because** the exit
works with the engine dead. Both halves shipped and are proven end-to-end.

---

## Part 1 — CONFIG off the performance surface

### This REVERSES report `_250`

`_250` put CONFIG and its three sub-views (STUDIO / MIDI / OSC) on the
performance rail (`showInPerformance: true`) as an **offline escape hatch**.
Its reasoning was sound at the time: performance mode is owned by the engine
and the flip is an engine route, an auth-enabled engine BOOTS locked (docs/56
D1 + `_228`), so a pad that could not reach its engine had no way off the
locked face — and CONFIG, the surface holding the engine-address card, was
hidden by the very lock you needed CONFIG to escape.

The operator has now reversed that decision, and the reversal is right: it was
the correct fix on the wrong door. It parked a **setup** surface on the
**live-show** rail permanently, to cover a failure mode that only ever occurs
with the engine unreachable. The escape hatch belongs on the exit itself.

Per the brief, everything `_250`'s CONFIG-in-perf was protecting against is now
covered by the exit path — that verification is the whole of §"The hard gate"
below, and it uncovered a real trap that had to be severed first.

### What the exit depended on, engine-wise

Two distinct paths, and only one of them was ever engine-bound:

| Path | Engine dependency |
|---|---|
| **Engine reachable** — `PerformanceModeControl.doExit` → `POST /performance-mode {active:false, exitAction}` | **Total.** The mode only changes on the engine's accepted response (no optimistic flip, by design). Correct, and untouched. |
| **Engine unreachable** — the chip routes to `setLocalPerformanceView(!active)` | **None already.** `_250`'s client-local view override: no request, no passcode, nothing persisted, discarded on reconnect. All three sheets are force-hidden while `engineOffline`, so no dialog can POST into the void. |

So the offline exit mechanism already existed and needed no severing. **The
break was not in the exit — it was in what the pad did with the answer.**

### The trap I found and severed

Both the sidebar rail and the deep-link guard computed the same expression:

```ts
!performanceModeReady || globalPerformanceActive   // "treat not-ready as locked"
```

Fail-closed on `!ready` is right **online** — it stops a cold pad flashing the
edit navigation over a live show in the milliseconds before the first
`GET /performance-mode` lands. Offline it is a permanent lock-out, because
offline readiness never arrives on its own: `usePerformanceMode` resolves while
disconnected **only once the operator has already taken a local view**.

Concretely, a pad that boots pointed at a dead engine sits at
`active:false` (DEFAULT-OFF — no show known anywhere), `ready:false`. Under the
old expression that is *locked*. With `_250`'s CONFIG-in-perf that was survivable;
the instant CONFIG leaves the performance set it becomes exactly the trap the
operator must never hit:

- the rail freezes to Deck/Mixer/Live Touch/Events with **no CONFIG**;
- the mode chip reads idle **"PERF"** (because `active` is false), so the first
  tap sets the local override to `true` — the *wrong direction*, deeper into the
  lock — and only a **second** tap reaches edit;
- and worse, `PerformanceRouteGuard` returns `null` while `!ready`, so even a
  direct `/config` deep link renders a **permanently blank screen**.

That last one is a latent `_250` gap in its own right: CONFIG was *listed* in
perf mode but a never-connected pad opening it got a blank page.

**The severing** — one shared rule, `performanceNavigationLocked()`, now used by
both consumers so they cannot drift:

```ts
if (engineOffline) return active;   // the presented face IS the answer
return !ready || active;            // online: unchanged, still fail-closed
```

plus the guard's hold is now exempt offline (`if (!performanceModeReady &&
!engineOffline) return null;`), so CONFIG actually mounts.

Result, both recovery shapes:

- **engine dies mid-show** → last-known face is performance → rail stays locked,
  CONFIG stays hidden → chip reads **EDIT** → **one tap** → edit view, CONFIG back;
- **pad boots against a dead address** → `active:false` → **zero taps**, CONFIG
  is simply there, and its deep link mounts.

### Is this a forbidden fallback? No — and here is the argument

A reviewer could squint at "offline behaves differently" and reach for codex P0.
It does not apply, for three reasons:

1. **The operator specified it.** Engine-independent exit is the literal ask, and
   the hard gate on ask 1. This is the spec, not a silent substitution.
2. **Nothing is hidden.** A fallback is forbidden because it *masks* a failure.
   This does the opposite: the chip carries a standing `ENGINE OFFLINE` caption,
   adds `LOCAL VIEW` once a local face is taken, and the deck/mixer paint a red
   `ENGINE OFFLINE — Cannot reach MarsinEngine. Check Config tab for IP
   settings.` banner throughout. The pad says exactly what it is doing.
3. **No gate is loosened.** This is presentation only. With the engine
   unreachable there is no request to gate; every real gate is enforced
   engine-side per request (docs/56 D2/D3/D6); and on reconnect `_localOverride`
   is discarded and the engine's broadcast wins outright (`_250`'s invariant,
   still pinned).

### Known, bounded cosmetic window

On a cold boot against a **live, locked** engine there is a sub-second window
where `engineOffline` is still true and the REST seed has not landed, so the
rail briefly shows the edit tabs. It closes the moment `GET /performance-mode`
answers. Strictly better than the status quo (where CONFIG was *always* visible
during a show), nothing unsafe can be mounted (the engine gates everything), and
fixing it properly would need a "never connected" vs "disconnected" distinction
the bus does not currently expose. Recorded, not fixed.

---

## Part 2 — playlist changing during a show (deck + mixer)

The client was not the only gate: **the engine 409'd the switch too**, so a
client-only unlock would have produced a refusal toast, not a working switch.
Both halves are open now.

### Engine — exactly two routes left the 409 table

| Route | Surface |
|---|---|
| `POST /deck/playlist` | deck primary playlist |
| `POST /mixer/channels/:id/playlist` | mixer channel playlist |

This does not weaken what the lock protects. The gate blocks **structural** and
**persistent** changes and a playlist switch is neither:

- **not persistent** — the handlers' `saveAllState()` is *already* a no-op while
  a show is live (`effectiveAutoSave()` reads `!performanceMode.active`), so a
  mid-show switch writes **zero bytes** and a restart reverts it. Verified by
  byte-comparing `deck_state.yaml` / `mixer_state.yaml` across a live switch.
- **not structural** — no channel, playlist, view or overlay is created,
  destroyed or reordered. It is the same class of runtime selection as
  `POST /deck/playlist/entry`, which has always been open.
- **RESTORE still works** — `captureLook()` serializes the channel playlist into
  the pre-show snapshot, so exiting via RESTORE puts back the playlist the
  operator went live with. Pinned by a new test.

### What stays locked (the allowance is targeted, enumerated)

Still 409 during a show: `POST /playlists` (create/save), `DELETE
/playlists/:name`, `POST /deck/playlist/secondary` (split-pane **binding** — that
one is structural), `POST /deck/playlist/capture`, `POST
/mixer/channels/:id/playlist/capture`, `POST /deck/overlays/:id/playlist`
(overlays are structural additions), the modulation/midi-mapping PUTs, plus the
whole pre-existing gated matrix (channel CRUD, reorder, viewSelection, snapshots,
settings, scene, save-pattern, effects deploy).

Client-side still hidden during a show: the folder / `+` add-pattern buttons,
per-row reorder chevrons and remove, the split-pane `✕` and `+ SECOND PLAYLIST`
bar (they drive the still-gated `secondary` route), and — new — the playlist
library's **duplicate / delete / NEW** rows.

### Client — one policy, one module

New pure module `CaptainPad/components/playlist_access_logic.ts` splits the old
single `editable` predicate:

```ts
selectable: !locked                                    // switch which playlist plays
editable:   !locked && !perfLocked && !persistLocked   // author the library
```

`PlaylistPanel` is the ONE playlist surface in the app (deck primary, deck split
pane 2, every deck overlay, every mixer channel), so pinning this policy pins
both the deck path and the mixer path — which is also why **no owned file needed
editing** (see Concurrency below).

Two judgement calls worth flagging:

- **`persistLocked` is deliberately NOT in `selectable`.** It answers "will the
  engine write this to disk", which is the wrong question for an action defined
  as non-persistent. It also would have silently re-blocked the operator's ask on
  every real show engine: during a show the engine pins `editPrincipal` to
  `null`, so `useEditPersistLock()` is **true** whenever `authRequired` is — the
  feature would have worked on the bench and failed on the playa.
- **`locked` (per-channel read-only) still outranks both** — a channel you may
  not drive is not one you may re-point.

The library modal now takes `crudEnabled` and, when false, hides its editing rows
and says why: `SWITCH ONLY — PLAYLIST EDITING RESUMES IN EDIT MODE.` (an
affordance that silently vanishes is the thing `_236` taught us not to ship).

---

## Files changed

**CaptainPad**
- `utils/captainpad_tab_policy.ts` — `config`/`studio`/`midi`/`osc` →
  `showInPerformance: false`; new `performanceNavigationLocked()`.
- `app/(tabs)/_layout.tsx` — rail uses the shared rule.
- `components/performance_route_guard.tsx` — shared rule + offline exemption
  from the `!ready` blank-screen hold.
- `components/PlaylistPanel.tsx` — `selectable` vs `editable`; `crudEnabled` on
  the library modal.
- `components/playlist_access_logic.ts` **(new)** + `.test.ts` **(new)**.
- `utils/captainpad_tab_policy.test.ts`, `hooks/usePerformanceMode_offline.test.ts`
  — updated for the reversal, plus new pins.

**Engine**
- `lib/api_server.js` — two gate lines removed, each replaced with the reasoning.
- `tests/mixer/performance_mode.test.js` — gated table updated; new test 3b
  proving the switch works, freezes disk, keeps CRUD refused, and RESTORE
  returns the pre-show playlist.

**Tools** (`simulation/agent_tools/`)
- `perf_config_hide_verify.cjs` **(new)** — V1-V6 incl. the kill-the-engine proof.
- `perf_config_hide_shots2.cjs` **(new)** — edit-rail framing + the mixer half.

---

## Gates

| Gate | Result |
|---|---|
| CaptainPad vitest | **106 files · 2323 passed · 6 skipped · 0 failed** (baseline moved 2281→2312→2323 under concurrent agents tonight) |
| CaptainPad `tsc --noEmit` | clean |
| `expo lint` | **0 errors**, 14 warnings — all pre-existing, none in touched files |
| Engine `tests/mixer/performance_mode.test.js` | **12/12** |
| Engine full `npm test` | 6 failures, **all foreign** — `tests/mixer/all_models_load_lint.test.js` (`dev_test_bench` sidecar) and `tests/e2e/ws_frame_crashproof.test.js` (timeline replay). Both live in files another agent has modified in the shared tree; neither is reachable from a two-line playlist-gate change. |
| Security scan | `--all` reports 82 repo-wide findings, **zero in any file I touched** (all pre-existing: scene backups, the tracker, older reports) |
| Expo web export | clean |

## Browser verification — all checks passed

Scratch stack: engine `:17968` (`MARSIN_CONFIG_FILE` with OSC + fire-sync +
web_client disabled and every controller host black-holed to TEST-NET-1,
`MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR` redirected, VSN1 deploy off, auth
flag explicit), dist served on `:7181`, output `~/tmp/perf_config_hide/`.
Confirmed the scratch engine bound **no** OSC/fire-sync port. A request
interceptor aborts any stray `:69xx` call. Live `:6966-:6972` / `:6981` never
bound or contacted; both scratch servers torn down; `CaptainPad/dist` untouched.

- **V1** edit mode: CONFIG owns a rail slot · **V2** performance mode: CONFIG
  and its sub-views **gone**, Deck/Mixer/Live Touch/Events remain, authoring
  surfaces still frozen out · **V3** identical in portrait.
- **V4/S2** performance mode: deck **and** mixer playlist dropdowns stay live,
  the library opens, a switch really lands on the engine
  (`show_alpha → show_bravo`), the show lock is still on afterwards, CRUD rows
  hidden, `POST /playlists` still 409.
- **V5 the hard gate** — engine **killed** mid-show: pad noticed in **26 ms**;
  CONFIG still hidden on the offline performance face; **the UI exit completed
  in 329 ms**; pad honest (`ENGINE OFFLINE` + `LOCAL VIEW`); full edit rail back;
  **and the CONFIG screen actually mounted** (4198 chars of real content, not a
  blank guard).
- **V6** cold boot against a black-holed address: CONFIG reachable with **zero
  taps**, and a `/config` deep link mounts.

**Offline exit timing: 329 ms, no hang, no blocking error state.**

### Screenshots — `C:\Users\Titanic's End\tmp\perf_config_hide\shots\`

`v1_edit_mode_config_present.png` · `s1_edit_mode_config_in_frame.png` ·
`v2_performance_mode_config_hidden_landscape.png` ·
`v3_performance_mode_config_hidden_portrait.png` ·
`v4a_perf_deck_playlist_dropdown.png` · `v4b_perf_playlist_library_open.png` ·
`v4c_perf_playlist_switched.png` · `s2a_perf_mixer_playlist_dropdown.png` ·
`s2b_perf_mixer_library_open.png` · `s2c_perf_mixer_playlist_switched.png` ·
`v5a_engine_dead_perf_face_config_hidden.png` ·
`v5b_offline_exit_config_reachable.png` ·
`v5c_offline_config_screen_mounted.png` ·
`v6_cold_boot_black_hole_config_reachable.png` ·
`v6b_cold_boot_config_deep_link_mounts.png`

All visually inspected. Note: the mixer captures show a `Failed to fetch` box in
the pixels pane — that is the harness's own `:69xx` interceptor, not a defect.

---

## Deployment

- **CaptainPad rebuild REQUIRED** (tab policy, route guard, playlist panel).
- **Engine restart REQUIRED** — the two gate removals are in `api_server.js`;
  until the live `:6968` engine restarts it will keep 409-ing playlist switches
  during a show, and the pad's now-tappable dropdown would earn a refusal.

## Concurrency

No file on the no-touch list was edited. `app/(tabs)/index.tsx`,
`app/(tabs)/mixer.tsx`, `hooks/use_mixer_workspace.ts`, `components/mixer/*`,
`components/deck/deck_workspace_layout.ts` and the colours-window components are
**untouched** — the playlist gate turned out to live entirely in the shared
`PlaylistPanel.tsx`, so **no residual edit in an owned file is needed**. The
`split_playlist_panes.tsx` `perfLocked` gate was deliberately left alone: it
drives the still-gated `secondary` binding route, so it is correct as-is.

## Open / follow-ups

- **Split pane 2 and deck overlays still cannot change playlist during a show.**
  I read the ask as the deck's primary playlist plus mixer channels, and kept
  `secondary`/overlay gated because those routes *bind* a pane or an overlay
  (structural). If the operator meant pane 2 as well, that is a small follow-up:
  ungate `POST /deck/playlist/secondary` for the re-bind case and flip the two
  client gates.
- The cold-boot cosmetic flash described above.
- `EditSessionChip` can still show a stale `NO EDIT SESSION — NOT SAVING`
  offline — pre-existing, inherited from `_250`, untouched.
