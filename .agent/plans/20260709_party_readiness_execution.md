# Party Readiness — Execution Plan (2026-07-09 night)

**Party: Saturday 2026-07-11.** Planned by a Fable coordinator for **Opus
executor agents**. The coordinator dispatches and verifies; Opus agents
implement. Branch: `feat/party_integration_20260711` (everything uncommitted;
commits are operator-gated — security check first, never `--no-verify`).

## Where we are (hardware-confirmed, 2026-07-09)

- **MFT** — fast-twist FIXED, Sina: "works perfect". Full-range `value−64`
  decode, linear step, `ACCEL_GAIN_MAX = 3.0`. **Do not retune the feel.**
- **APC mini** — remapped + working: shift = deck/mixer, track buttons =
  focus channels, clip_stop = combined autopilot, stop_all = blackout.
  Layout doc: `docs/midi/apc_mini_2.md` (see docs/midi/).
- **VSN1 auto-deploy** — pipeline verified end-to-end via API on 2026-07-09
  (slot rename → 1.2 s debounce → one-page COM12 flash → `lastResult: ok`).
  Gate is ON (`marsin_engine/config.yaml → vsn1.deployLayout: true`). A fatal
  unhandled-rejection race in the serial waiters was found and fixed
  (grid_serial / restore / write / read_config `.catch` guards, uncommitted).
  **It only "doesn't work" when the stack is down — the engine spawns the
  deploy.**
- Engine restart-activated fixes pending hardware smoke: glitch-free live
  params, `/global-effects/reset-all` + `/disable-all`, trigger reliability.

## Sina's directives (tonight)

1. **One VSN1 page only.** The 4 SMALL buttons (panel elements 9–12,
   `sb_0..sb_3` — misnamed "side buttons" in the templates; see
   docs/42 Terminology) must STOP switching pages. THE physical side button
   is the page switcher, firmware-native, works fine — leave it alone.
   Do page 0 right; more pages after the party.
2. **Auto-deploy must work from CaptainPad**: change an effect → the VSN1
   LCD shows the new name. (Chain exists; needs the stack up + hardware proof.)
3. Effects screen **UI polish** (punch list from Sina needed).
4. **Three playlists**: `party_high`, `party_low`, `ambient`.
5. **Pattern tuning on the DMX test bench** — parallel track, separate agent.

## Track A — Effects controller wrap-up (Opus, THIS session's zone)

Zone: `CaptainPad/**`, `marsin_engine/tools/vsn1_config/**`,
`marsin_engine/lib/{api_server,global_effect_*,vsn1_layout_deploy}.js`.
**Only ONE agent in the CaptainPad zone at a time** (concurrent agents have
corrupted each other before — serialize).

### A1 — Stack up + CaptainPad→VSN1 proof (first, ~15 min)
`node launcher.js dev --scene test_bench --no-launch`. Engine status
`/global-effects/layout → deploy.enabled: true`. Then on hardware: swap an
effect in CaptainPad's effects screen → expect SYNCING on the VSN1 →
new name on the LCD. CaptainPad calls the same PATCH the API proof used
(`utils/api.ts patchGlobalEffectSlot`). If the CLI dies mid-flash, read
`deploy.lastError` — the waiter-race crash is already fixed; anything new is
a real finding. Watch launcher fragility: any child exit tears down the
whole stack (launcher.js:598); Metro dies compiling mid-edit files — don't
edit CaptainPad files while Metro compiles them.

### A2 — Small buttons stop paging (bundle with A3, ONE flash)
- Terminology (docs/42): elements 9–12 are the SMALL panel buttons
  (`sb_0..sb_3`); `side_button.lua` is a misnamed template for THEM. The real
  side button = firmware-native page switcher — untouched, stays working.
- `templates/effects_layout/side_button.lua`: **remove the local
  `page_load(N)`**; keep the MIDI note (`sbNoteBase` 41+N) out — host decides.
- Host mapping (Sina's earlier picks, confirm sb_0/sb_1): sb_2 →
  `POST /global-effects/reset-all`, sb_3 → `POST /global-effects/disable-all`
  (endpoints are live). sb_0/sb_1: no-op until Sina picks.
- Because THE side button still changes pages, the welcome-logo fix (A3)
  must handle page-load re-arm regardless — the host-driven design does.
- CaptainPad effects screen: pin/hide the page switcher in single-page mode
  (page 0 only). Keep `computeVisibleSlots` intact — just don't expose paging.
- Respect the 909-char action-string budget; current budgets: LCD INIT 864,
  encoder 907, DRAW 886 — side_button has room.

### A3 — Welcome logo: initial load only (bundle with A2)
Root cause: `templates/effects_layout/lcd_init.lua:31` sets `hi = 1` on
EVERY page-load VM restart (device can't distinguish power-on from page
change; page changes also go away with A2, but boot vs. reconnect still
matters). Fix = **host-driven**: device INIT defaults `hi = 0` (live layout
immediately); the host sends the existing hello CC (`encoder_init.lua`
dismiss path inverted: a dedicated "show welcome" arm) ONLY on first engine
connect, never again. Sina wants to be hands-on — walk him through the
template diff before flashing. Deploy A2+A3 as one page-0 flash:
`node tools/vsn1_config/deploy_layout.cjs --from-engine --page 0 --live`.

### A4 — Effects screen UI polish
Blocked on Sina's punch list. Collect gripes on hardware right after A1.

### A5 — Verifications (cheap, interleave)
- Mixer focused-channel MFT fix (agent-landed, needs hardware check:
  APC focus button → MFT locals move the focused channel; deck lag gone?).
- `npm test` in marsin_engine must leave `git diff states/` clean and
  audio_state.yaml still on the Amazon mic (B12 regression guard).
- Glitch-free live param tuning (strobe hz live-tune, no black flash),
  reset-all / disable-all endpoints, fast hand-drummed triggers.

## Track B — Playlists (Opus, engine/state zone)

Goal: `party_high`, `party_low`, `ambient` playlists, fast to switch from
CaptainPad during the party.
1. Discover the mechanism: `config.yaml playlist:` (engine boot playlist),
   per-channel `playlist` in mixer/deck state
   (`lib/state_manager.js:29,358`), CaptainPad deck playlist UI.
2. Sina curates pattern membership from `marsin_engine/patterns/` (~30
   patterns, `00_golden_hour_wash` … `29_kick_shockwave`). Draft a proposal
   (high = beat-reactive/strobing; low = groove/flow; ambient = slow washes)
   for him to edit rather than asking cold.
3. Implement as three named playlists switchable without editing YAML at
   party time; verify switching live on the stack.
4. File zone: engine states/config + (if needed) CaptainPad deck UI —
   coordinate with Track A if touching CaptainPad (serialize!).

## Track C — Pattern tuning + LED integration (SEPARATE agent)

Runs in its own session with the prompt Sina was handed (see report/task
#12). Zone: `marsin_engine/patterns/**` (+ pattern-side model tweaks).
**Must not touch** CaptainPad/, tools/vsn1_config/, engine lib/. Shares the
live stack; engine restarts only with Sina's say-so. Tuning rules from
memory: **pattern slider declaration order = MFT knob order**; **"direction"
must be the 2nd local param**.

## Track D — VSN1 UI Lab (rapid on-hardware UI iteration; Opus + Sina live)

**Goal (Sina, 2026-07-09 night):** a HIL (hardware-in-the-loop) workflow to
programmatically flash EXPERIMENTAL UIs to the VSN1 LCD in seconds, so the
loop is: agent flashes variant → Sina looks at the device → feedback →
tweak → reflash. Winning designs then get folded into the real templates.

### D1 — The harness: `marsin_engine/tools/vsn1_utils/`

New sibling of `midi_discovery/` and `vsn1_config/`. One CLI, e.g.
`ui_lab.cjs`, that is a THIN ergonomic wrapper — all serial logic reused
from `vsn1_config/grid_serial.cjs` and the single-element writer
`vsn1_config/write_config.cjs` (which already does
`--element N --event DRAW --lua file --live`). Do NOT duplicate protocol
code.

Capabilities:
- `node ui_lab.cjs --variant <name>` — flash a UI variant to the live
  device. A variant = a dir `vsn1_utils/variants/<name>/` holding one or
  more Lua files named by target (`lcd_draw.lua`, `lcd_init.lua`,
  `encoder_init.lua`…); the CLI writes each to its element/event on page 0.
  Most experiments are DRAW-only → ONE config write, seconds not minutes.
- **Ephemeral by default**: do NOT send PAGESTORE — the write registers live
  in the Lua VM but is not persisted, so a power-cycle (or `--restore`)
  reverts to the flashed production page. `--store` opts into persistence.
  (This is the safety property that makes rapid experiments non-scary.)
- `--restore` — re-flash the production LCD INIT/DRAW from
  `templates/effects_layout/` (via the normal deploy path or write_config)
  to exit lab mode cleanly.
- Budget + round-trip validation before any write (909-char CONFIG_LENGTH),
  read-back verify after (write_config already does both).
- Substitution support: variants may use the same `__NAMES__`/`__COLORS__`
  placeholders; the CLI fills them from the engine layout
  (GET /global-effects/layout) or from a `--mock` fixture when the engine
  is down.
- Pre-flight without hardware: render the variant in `tools/vsn1_sim/`
  (HTML VSN1 simulator) where feasible — catches Lua typos before COM12.

### D2 — COM12 discipline (single-holder port)

The engine's auto-deploy spawns the deploy CLI on layout changes. Rule
during lab sessions: **don't edit slot layouts in CaptainPad while
iterating**, and the CLI must check `GET /global-effects/layout →
deploy.deploying` and refuse to open the port while a deploy is in flight
(fail loud, retry when idle). Never two processes on COM12.

### D3 — The iteration protocol (agent + Sina at the device)

1. Agent flashes variant, announces "variant X on device".
2. Sina reports what he sees (photo or words).
3. Agent edits the variant Lua, reflashes (seconds), repeat.
4. Keep a `variants/<name>/NOTES.md` log of what was tried and the verdict.

### D4 — Integration

A winning variant is ported into `templates/effects_layout/` (respecting
the substitution placeholders + budgets), validated with the deploy
dry-run, then flashed once via the production path
(`deploy_layout.cjs --from-engine --page 0 --live`). Sequencing: the
views agent (drum/effect views, welcome logo) is editing lcd_draw/lcd_init
RIGHT NOW — land its output first, then experiment on top of it.

### Stack keep-alive (prerequisite, coordinator-owned)

The launcher stack must stay up (engine :6968 is both the deploy trigger
and the layout source). Coordinator runs `node launcher.js dev --scene
test_bench --no-launch` in the background, probes :6968 after boot and
after every lull, and relaunches on death (known fragility: any child exit
tears the stack down, launcher.js:598; Metro dies compiling mid-edit
files). Agents never restart the stack unilaterally.

## Coordination rules

- One CaptainPad-zone agent at a time. Track B and C are parallel-safe with
  A as long as zones stay disjoint.
- The launcher stack is shared and fragile: schedule engine restarts, don't
  let agents restart it unilaterally.
- No git operations until Sina asks. Before commit: `python
  scripts/security_check.py --staged` + touched subsystems' auto-checks.
- Engine writes runtime residue into tracked `marsin_engine/states/` —
  report, don't commit or revert silently.

## Exit gates (party-ready = all true)

- [ ] CaptainPad effect swap shows up on the VSN1 LCD unattended (A1)
- [ ] Side buttons never change pages; reset-all/disable-all work (A2)
- [ ] Logo only on power-on/first connect (A3)
- [ ] Sina signs off the effects screen UI (A4)
- [ ] Three playlists switchable live from CaptainPad (B)
- [ ] Patterns tuned on the bench, MFT knob order correct (C)
- [ ] MFT + APC + VSN1 all pass a 10-minute hand-on-hardware smoke
