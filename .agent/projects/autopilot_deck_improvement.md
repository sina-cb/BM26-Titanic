---
name: autopilot_deck_improvement
status: active        # active | paused | done
owner: coordinator (Opus multi-agent run)
created: 2026-07-06
updated: 2026-07-06
---

# Autopilot + Deck Improvement — MASTER EXECUTION PLAN

This is the **entry point** for the Opus multi-agent run. It owns scope, the
git/branch flow, the slice plan, the consolidated operator gates, and the
done-definition. Deep design detail lives in two reference dossiers:

- [`autopilot_profiles_audio_reactive.md`](autopilot_profiles_audio_reactive.md)
  — autopilot profiles, per-scene persistence, audio-reactive profile, dropdown.
- [`deck_split_playlists.md`](deck_split_playlists.md) — two stacked resizable
  playlist panes.

Both were produced from read-only Fable design passes (2026-07-06) with exact
`file_path:line` citations. **Nothing has been built, run, or committed yet.**

## Goal (three features, one branch)

1. **Autopilot profiles** — the deck autopilot becomes a set of named profiles;
   today's behavior is the `random` profile (byte-identical). The active profile
   is a **dropdown in CaptainPad**, persisted in **per-scene** engine state.
2. **`audio_reactive` profile** — a new profile driving pattern selection,
   color, and slow/fast (tempo) from Audio Companion signals.
3. **Deck split playlists** — the deck playlist area becomes two stacked,
   vertically **resizable** playlist list-views; the second is **optional**; the
   single right-hand parameter panel is unchanged; the deck still plays one
   pattern.

## Deliverable branch & git flow (operator instruction — follow exactly)

- The **only** branch that goes to `origin` is **`feat/autopilot_deck_improvement`**.
  All three features land there.
- Sub-agent worktree branches are **`dev/*`, local-only — never pushed to
  origin** (`.agent/os/multi_agent.md:98-100`).
- **Flow (instigator, only when the operator says go):**
  1. Create/confirm `feat/autopilot_deck_improvement` (promote the current
     auto-named session branch to it via GitHub rename, or branch it from the
     agreed parent — operator's call). This is the parent for all worktrees.
  2. `git worktree add -b dev/<slug> ~/workspace/BM26-Titanic-worktrees/<slug>
     feat/autopilot_deck_improvement` per slice.
  3. Sub-agents commit to their `dev/*` branch (local), write reports, do NOT push.
  4. On operator approval, instigator merges each `dev/*` into
     `feat/autopilot_deck_improvement` (safest-first: engine additive, then
     CaptainPad, then validation is report-only), runs the full post-merge
     verification (`.agent/os/multi_agent.md:307-353`), and pushes **only**
     `feat/autopilot_deck_improvement` to origin.
- **No git operations happen until Sina explicitly asks.** Every commit passes
  `python scripts/security_check.py --staged` first; never `--no-verify`.
- Move these three dossiers onto `feat/autopilot_deck_improvement` when the run
  starts; they currently sit on the session worktree branch.

## Slice plan (decomposed by SUBSYSTEM = by file ownership)

The two big shared files are `marsin_engine/lib/api_server.js` (all engine work)
and `CaptainPad/app/(tabs)/index.tsx` + `PlaylistPanel.tsx` (all UI work). Per
`.agent/os/multi_agent.md:33-37` we do **not** fan multiple agents onto the same
file. So the run is **two parallel dev slices split by subsystem** (engine vs
CaptainPad — zero shared files between them), each doing ordered internal phases,
plus one validator. Engine and CaptainPad build against the **frozen contracts**
in the reference dossiers, so they run concurrently; the validator runs after
both merge.

| Slot | Branch (`dev/*`, local) | Subsystem | Ordered internal phases |
|---|---|---|---|
| 0 | `dev/deck_autopilot_engine` | marsin_engine | E1 autopilot profile seam + `random` + per-scene persistence + REST/WS(`profile`,`profiles`) → E2 Spike 0 + `audio_reactive` profile → E3 deck playlist slots (state, routes, `serializeDeckState` fold, persistence, `noteDeckLivePlaylist`) |
| 1 | `dev/deck_autopilot_captainpad` | CaptainPad | U1 autopilot profile dropdown (`autopilot_profile_picker.tsx`, panel + `index.tsx` wiring) → U2 split panes (`split_playlist_panes.tsx`, `deckSlot` role in `PlaylistPanel`, `api.ts`, `index.tsx`) |
| 2 | `dev/deck_autopilot_validation` | full-stack | after 0+1 merge: HIL battery + sim screenshots + audio-fixture proof + full-stack smoke |

Ports per slot from `.agent/os/multi_agent.md:174-184` (slot 0 engine `31068`,
slot 1 metro `31181`, slot 2 as needed). Each dev slice owns disjoint files:

- **Slot 0 files:** `marsin_engine/lib/api_server.js`, `marsin_engine/lib/autopilot.js`,
  new `marsin_engine/lib/autopilot_profiles/*.js`, new
  `marsin_engine/tests/hil/*.mjs` + unit tests. (No CaptainPad files.)
- **Slot 1 files:** `CaptainPad/app/(tabs)/index.tsx`,
  `CaptainPad/components/PlaylistPanel.tsx`, `CaptainPad/utils/api.ts`, new
  `CaptainPad/components/deck/autopilot_profile_picker.tsx` +
  `CaptainPad/components/deck/split_playlist_panes.tsx`. (No engine files.)
- **Slot 2 files:** none (report only, `.agent/reports/202607/`).

**Why ordered phases inside a slice, not more agents:** E1/E2/E3 all edit
`api_server.js`; U1/U2 all edit `index.tsx`. Splitting them across agents would
race the same file. One agent per subsystem edits sequentially — safe, and E1's
frozen `profile`/`profiles` WS fields + E3's `playlistSlots` `deck`-message
fold are exactly what U1/U2 consume, so slot 1 can build against the reference
dossiers from the start and integration-test against slot 0's engine once E-phases
land.

## Per-slice Opus briefs (self-contained)

> Prepend to every brief: "Read `.agent/os/multi_agent.md`, `.agent/codex.md`,
> `.agent/os/nodejs_style.md`, and (UI) `.agent/os/ui_design.md`. Operate ONLY in
> your worktree `~/workspace/BM26-Titanic-worktrees/<slug>` on branch `dev/<slug>`,
> slot `<N>` ports. Commit only to your branch; write a report under
> `.agent/reports/202607/20260706_<slot>_<slug>.md`; do NOT push to origin. Run
> `python scripts/security_check.py --staged` before any commit; never
> `--no-verify`. Hard rules: no fallbacks (fail loudly — invalid input 400s,
> absent optional field uses the ONE documented default), all imports top-of-file,
> snake_case new files, offline-ready (no new deps/CDNs), no temp files in the
> source tree. After tests, restore `marsin_engine/states/*.yaml` in a `finally`;
> `git status` must show only your intended diff. Read every cited file before
> editing it."

### Slot 0 — `dev/deck_autopilot_engine` (marsin_engine)

Full design: the two reference dossiers. Build in this order, committing per phase.

- **E1 — Profile seam + persistence + REST/WS.** Refactor `autopilot.js` so the
  host consults a `profile` instance (`nextDelayMs` null ⇒ event-driven via new
  `ctx.requestAdvance()` → existing `_runTick`). Add `autopilot_profiles/{profile_registry,
  random_profile}.js` + `AUTOPILOT_PROFILES`/`AUTOPILOT_PROFILE_DEFAULT`/
  `normalizeAutopilotProfile`. `random` wraps `pickNextAutoCycleEntry`
  (byte-identical). Profile persists as a **string on `playlist.autopilot.profile`**
  (per-scene via the existing `serializeChannel`→`deck_state.yaml` path — ZERO
  new persistence plumbing; do NOT write config.yaml). Dispatch on profile in the
  selection callback (`api_server.js:3298-3344`, throw on unknown). Add
  `profile`+`profiles` to `deckAutopilotState`/`broadcastAutopilot` **and the
  connect replay** (`:7907-7918`). `POST /deck/playlist/autopilot` accepts
  `profile` (unknown→400 loud). Restore-time: unknown profile→warn+clear to
  `random` (`:2102-2108` precedent). **Acceptance:** unit test pinning `random`
  == legacy picker for a seeded sequence; HIL (engine `31068`) — no-`profile`
  arm behaves as before, WS carries `profile:'random'`+names, per-scene round-trip.
- **E2 — Spike 0 + `audio_reactive`.** Do **Spike 0** first (verify
  `audioSwitchPattern/Color` pulse survival vs OSC throttle,
  `companion_server.js:145-171` / `switch_signals.js:69-90`); record it in the
  report. Then `autopilot_profiles/audio_reactive_profile.js` per the autopilot
  ref §"Audio-reactive profile behavior" (event-driven advance on
  `audioSwitchPattern`; `audioNoteHue`→nearest palette on `audioSwitchColor`;
  `bpmSpeedSync` for speed, restored on detach; silence/`maxDwellS` gates;
  transition punch on riser/drop). Register in the registry. **Acceptance:** HIL
  injecting synthetic CPC — pattern advances on a pulse, palette changes on a
  color pulse, `bpmSpeedSync` set on arm / restored on disarm, silence suppresses,
  `maxDwellS` forces advance. Report every signal you could NOT use (spectral
  centroid, per-entry energy) and what adding it needs.
- **E3 — Deck playlist slots.** Per the deck ref §"Engine model" / §"API/WS":
  `deckPlaylistSlots{primary,secondary,splitRatio}` state + boot restore/validation;
  `noteDeckLivePlaylist` at the two live-name choke points; routes `GET
  /deck/playlist/slots`, `POST /deck/playlist/secondary`, extended `POST
  /deck/playlist/entry {slot?}`, `POST /deck/playlist/split`; fold `playlistSlots`
  (+ `serializeDeckPlaylistSlot`) into `serializeDeckState` (NO new WS type);
  persist via `saveAllState` extras. Reuse `loadPlaylistEntryWithTransition` — no
  new swap path. **Acceptance:** HIL — assign secondary; drive via `slot:'secondary'`
  → live flips, primary stable; 400 on dup-name and out-of-range ratio; 409
  mid-transition; restart → slots+ratio round-trip from `deck_state.yaml`;
  clear-while-live promotes.
- Run `.agent/ops/marsin_engine_auto_checks.md`. Confirm both frozen contracts
  match what shipped; if you deviate, update the reference dossier + flag slot 1.

### Slot 1 — `dev/deck_autopilot_captainpad` (CaptainPad)

Full design: the two reference dossiers (UI sections). Build in this order.

- **U1 — Autopilot profile dropdown.** New `components/deck/autopilot_profile_picker.tsx`
  cloning the `TransitionStylePicker` modal idiom (`DeckTransitionControls.tsx:221-320`),
  placed as a `PROFILE` row inside `PatternAutopilotPanel`
  (`components/deck/pattern_autopilot_panel.tsx`). `usePalette()` tokens only
  (no hex), caps labels, `minHeight:44`. Wire `index.tsx` state/seed/reconcile +
  `utils/api.ts setAutopilotProfile` → `POST /deck/playlist/autopilot {profile}`,
  optimistic + rollback+Alert (`handleDeckTxChange` `:482-514`), planGate-guarded.
- **U2 — Split panes.** New `components/deck/split_playlist_panes.tsx`
  (PanResponder divider cloning `HorizontalFader.tsx:65-109`; MIN_PANE_PT clamp;
  POST ratio on release via new `setDeckPlaylistSplit`). Add `'deckSlot'` role to
  `ChannelRole` + `fetchChannelPlaylist`/`setChannelPlaylist`/`setChannelPlaylistEntry`
  in `api.ts`; one `role==='deckSlot'` WS branch in `PlaylistPanel` mirroring the
  `deckOverlay` branch (`:574-588`) + optional `onClosePane`. Replace the single
  deck panel mount (`index.tsx:747-777`) with `<SplitPlaylistPanes>`; pane 2
  opt-in/collapsed by default. Columns 2/3 (parameter panel) untouched.
- **Acceptance:** `npx tsc --noEmit && npm run lint` clean;
  `.agent/ops/captain_pad_auto_checks.md`. Manual web smoke on :6967 against slot
  0's engine (or a mocked `deck`/`autopilot` WS message until it lands — state
  which): change profile; assign/browse/drive both panes; drag divider; reload →
  ratio + slots + profile reconcile. Confirm optimistic rollback fires on a
  simulated `!ok`.

### Slot 2 — `dev/deck_autopilot_validation` (after 0+1 merge)

End-to-end, no feature code. Full-stack smoke per
`.agent/skills/full_stack_smoke.md`; sim screenshots per
`.agent/skills/see_the_world.md`. Prove: (a) `random` visually identical to
pre-change; (b) `audio_reactive` reacts to a known audio file (patterns advance
on drops, palette tracks music, speed follows BPM); (c) two panes drive with
transitions enabled and autopilot active — autopilot follows the last-driven
pane; (d) profile dropdown + split ratio persist across an engine restart
(per-scene). Run the FULL HIL battery + every touched subsystem's auto-checks
against the merged tip. Write the validation report + explicit **ready /
not-ready + why** for Sina.

## Consolidated operator gates

None block the run — sensible defaults are chosen so Opus can proceed; your
answers refine behavior. Grouped:

**General**
- **G1 — Notion.** Enable the Notion MCP connection + share the Titanic's End
  workspace so the "deck / playlist management" card's acceptance criteria can be
  confirmed. It was **unreachable** during analysis (no Notion tools present);
  the design is built to satisfy any reasonable answer without architectural
  change, but confirm before locking behavior.

**Deck** (defaults in the deck ref)
- **D1** Pane-2 assign is **browse-only** (assigning doesn't change what's
  playing; tap an entry to drive). OK, or make pane-1 assign also silent?
- **D2** Autopilot target = **last-driven pane** (no new control). OK, or an
  explicit A/B autopilot selector?
- **D3** Split ratio persists **per-scene = shared across all iPads**. OK, or
  per-device (AsyncStorage)?
- **D4** Add an explicit `· LIVE` tag to the live pane header?

**Autopilot** (defaults in the autopilot ref)
- **A1** `audio_reactive` must **not** touch brightness (grand master). OK?
- **A2** `maxDwellS = 300`, hold on silence. OK?
- **A3** Auto-arm `audio_reactive` on the party mood cue — **wire but flag off**
  until you see it. OK?
- **A4** Profiles are **deck-only** in v1 (mixer/overlay auto-cycles unchanged). OK?
- **A5** Radio parity — should `POST /autopilot` (LoRa/podium) also accept
  `profile`? (default: no)
- **A6** On profile switch mid-cycle: reset group window + let countdown finish
  (default) vs reschedule immediately?
- **A7** Approve the **separable** `config.yaml`→per-scene daemon-seed retirement
  as a follow-up commit/card? (removes a pre-existing dual-source-of-truth wart)
- **A8** Confirm dropdown labels/hints: `RANDOM` / `AUDIO REACTIVE`.

## Done-definition (ready for Sina to take over)

- All three features on `feat/autopilot_deck_improvement`, security-check green.
- `random` autopilot proven byte-identical; `audio_reactive` proven reactive on
  a real audio file (sim screenshots).
- Two resizable panes drive correctly; parameter panel unchanged; second pane
  optional; autopilot follows the live pane.
- Profile dropdown + second-playlist choice + split ratio persist per-scene
  across an engine restart.
- Full HIL battery + `marsin_engine`/`captain_pad`/`sim` auto-checks green on the
  merged tip; no tracked-state side effects.
- Validator's report says **ready**, with any residual gaps listed.

## Links

- **Design refs:** `autopilot_profiles_audio_reactive.md`, `deck_split_playlists.md`.
- **Reports:** `.agent/reports/202607/20260706_<slot>_<slug>.md` (per slice) +
  a final merge summary.
- **Deliverable branch:** `feat/autopilot_deck_improvement` (origin + local).
  Worktree branches: `dev/deck_autopilot_engine`, `dev/deck_autopilot_captainpad`,
  `dev/deck_autopilot_validation` (local-only).
- **Notion:** "deck / playlist management" card — UNREAD (MCP unavailable).

## Decisions log

- **2026-07-06** — Three features combined onto one deliverable branch per
  operator instruction; sliced by subsystem (engine / CaptainPad) not by feature,
  because the shared files (`api_server.js`, `index.tsx`) forbid multi-agent
  same-file editing. Engine + CaptainPad run in parallel against frozen contracts;
  validator last.
- **2026-07-06** — Deck design switched from "A·B pills" to two resizable panes
  (operator's revised vision); old dossier deleted.
- **2026-07-06** — Autopilot profile persists per-scene on `playlist.autopilot`
  (zero new plumbing); the config.yaml timing wart is a separate follow-up.

## Next steps

- [ ] Operator: answer the gates (esp. G1 Notion); confirm the branch flow.
- [ ] Instigator (on go): create `feat/autopilot_deck_improvement` + the three
      `dev/*` worktrees from it.
- [ ] Slots 0 & 1 build in parallel against the frozen contracts (slot 0 runs
      Spike 0 before E2).
- [ ] Slot 2 validates end-to-end; report ready/not-ready for Sina.
