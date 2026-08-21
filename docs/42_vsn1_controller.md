# 42 — Intech Studio VSN1 (third MIDI controller)

Sina's third control surface (confirmed 2026-07-08), joining the Midi
Fighter Twister and APC mini mk2. Product page:
<https://intech.studio/shop/vsn1>

## Technical specifications (from Intech)

- **320 × 240 pixel LCD screen** with great viewing angles
- **High-precision, endless jog-wheel**
- **Gateron Hall-effect key switches** with MX-style shaft
- Small, assignable tactile buttons
- Innovative **magnetic interface** for modular connection in any direction
  with other Grid controllers
- High-speed USB-C connection
- 250 mA power draw
- **RGB LED indicator for each control element**
- **Side button for page changes**

## Terminology (Sina, 2026-07-09 — get this right)

- **Small buttons** — the four assignable tactile buttons ON THE PANEL,
  device elements 9–12. Our config templates call them `sb_0..sb_3`
  (`templates/effects_layout/side_button.lua` — the filename is a historical
  misnomer; they are NOT side buttons). These are ours to map: they must NOT
  change pages; they carry host-mapped actions (notes `sbNoteBase` 41+N).
- **THE side button** — the single physical button on the module's side.
  Page changes are ITS job, handled by the Grid firmware natively (our
  deploys never touch it), and it works reliably. Keep it as the one and
  only page switcher.

## System integration notes

- Enumerates on Windows as **"Intech Grid MIDI device"** with two MIDI ports
  ([0] and [1]). Config/flash is over USB **serial COM12 @ 2 000 000 baud**
  (VID:PID 0x303A:0x8123), separate from the MIDI ports.
- **Profiled + wired as the effects controller** (2026-07). It drives the
  32-slot Global Effects layout; see "Effects UI + auto-deploy" below. The
  original discovery workflow (for reference): run
  `node marsin_engine/tools/midi_discovery/serve.cjs` → <http://127.0.0.1:6979>,
  do a labeled capture pass, export the JSON in
  `marsin_engine/tools/midi_discovery/captures/`.
- **Screen is pixel-programmable** via the Grid Lua API in Intech's **Grid
  Editor** app (LCD Draw event; text/rects/values/procedural graphics;
  widget library). Configs persist on the module's flash.
- **Runtime status-display path:** Grid Lua can react to incoming MIDI — so
  CaptainPad/engine can push values (BPM, focused channel, pattern name,
  sync state…) as MIDI and the VSN1's own Lua renders them on screen. The
  LED-feedback pipeline in CaptainPad's MIDI layer is the natural sender.
- Configuration app: **Grid Editor** (free, Windows/macOS/Linux) —
  <https://intech.studio/products/editor>. Docs: <https://docs.intech.studio/>.

## Effects UI + auto-deploy (2026-07, the party build)

The VSN1 is the **Global Effects controller**: the 8 keys are effect slots,
the encoder tunes the selected effect, the small buttons are utilities, and
the LCD renders the layout. The **engine is the source of truth** for the
32-slot layout (4 pages × 8 slots); CaptainPad edits it, and the engine keeps
the device in sync.

### Auto-deploy — the device UI follows the layout

When an effect is **added / removed / renamed / recolored** (a layout change,
via CaptainPad → engine `PATCH /global-effect-slots/:id`), the engine
recompiles the affected page's Lua and **re-flashes only that page** over
COM12. Runtime value/mode/active changes are NOT layout changes — they flow
as MIDI feedback, never a flash.

- **Pipeline:** `lib/vsn1_layout_deploy.js` (hook on the slot manager's
  layout-changed event) → debounce → `tools/vsn1_config/deploy_layout.cjs
  --from-engine --page N --live` → `restore_config.cjs` (per-page CONFIG
  writes + PAGESTORE). COM12 is a **single-holder** port: deploys are
  debounced (coalesce bursts) and serialized (never two flashes at once).
- **Deploy-on-load:** on engine boot the current layout is pushed to the
  device automatically, so a fresh stack always shows the right names/colors.
- **Manual re-sync:** `POST /global-effects/deploy` flushes the current
  layout to the device (populated pages).
- **Loading screen:** during every re-flash the LCD shows a temporary
  **"Loading / updating layout"** card (MarsinLED-orange), drawn via a Grid
  IMMEDIATE draw so it holds while the page's own draw handler is rebuilt.
- **Config gate** (`marsin_engine/config.yaml`):
  `vsn1.deployLayout` (master on/off), `vsn1.deployDebounceMs` (coalesce
  window, default 1200), `vsn1.deployOnBoot` (deploy-on-load, default true).
  Default-off in tests so the suite never flashes hardware.
- **909-char budget:** every element's compiled action string must be ≤
  `CONFIG_LENGTH` (909). LCD DRAW and LCD INIT are the tight ones; verify with
  the dry-run `node deploy_layout.cjs --layout layouts/example_layout.json`.
  A pathological fully-packed 8-slot page with max-length names + long mode
  names can overflow (fail-loud) — keep names within `MAX_NAME_LEN` (12).

### Behavior + views — DRUM everywhere, grid by default (Sina, 2026-07-10)

**Key behavior is DRUM, always**: pressing **any** key immediately fires that
slot's behavior-aware action (toggle flips, trigger fires) AND selects it
(the LCD follows the finger). The two-step select-then-commit contract is
retired.

The LCD has two **visuals** (presentation only — behavior identical in both),
toggled by `sb_1`, owned by the host and re-echoed on every resync
(`vm` CC, ch2 cc43):

- **GRID (default, `vm = 1`)** — the **2×4 color-rectangle grid**, COLORS
  ONLY (no per-cell text; dropping the abbreviations bought permanent LCD
  budget headroom). The pressed/selected cell gets a contrast border; the
  selected effect's compact detail line (name / value / mode / ON / P# /
  value bar) renders under the grid.
- **READOUT (`vm = 0`)** — no grid; a full-screen readout of the pressed
  effect (large name, very large value, mode line, raised value bar) plus the
  small-button labels along the bottom (`MODE VIEW PROF LOGO`).

### Small buttons (panel elements 9–12, `sb_0..sb_3`)

They **never change pages** (that's THE side button, firmware-native).
Sina's map (2026-07-10 evening):

- `sb_0` → **MODE** — cycle the selected effect's discrete mode (same action
  as the encoder press)
- `sb_1` → **VIEW** — toggle the LCD visual (grid ↔ readout), one press per
  flip
- `sb_2` → **BANK** — cycle to the next named effect **bank** (v3: banks
  replaced the old edit/play profile split). The manager POSTs
  `/global-effects/banks/next` (atomic engine-side cycle+wrap, no client-computed
  target); the engine broadcasts `effectBanks` + `globalEffectMacroStatus` and
  runs a page-0 redeploy, and CaptainPad's effects grid switches to the new
  bank's slots on the echo. No optimistic flip; the engine broadcast is
  authoritative.
- `sb_3` → **LOGO** — show the MarsinLED wordmark (the welcome screen; the
  next key press or feedback frame dismisses it)

Reset-all / disable-all moved OFF the small buttons; they remain reachable in
the CaptainPad UI (`POST /global-effects/reset-all` / `/disable-all`).

### Welcome logo — first connect only

The MarsinLED logo shows **only on first host connection / power-on**, never
on a page change. A page change restarts the device Lua VM (indistinguishable
from power-on on-device), so the logo is **host-driven**: device INIT defaults
to "no logo" (live layout immediately); CaptainPad arms the welcome exactly
once per fresh device connection. The device emits a **hello CC on every VM
restart**; the host re-pushes full state on each hello but only arms the
welcome on the first.

### Page sync — bidirectional

THE side button changes the device page; the device emits a **page CC**
(`pageCc` 40) which CaptainPad intercepts to `POST /global-effects/page`, so
the app + engine follow. App-side page changes already drive the device.

### MIDI map (deploy_layout.cjs `loadLayoutFromEngine`)

`feedbackChannel` 1, `modeChannel` 2, `slotBase` 32 (keys = note 32+k),
`pageCc` 40, `sbNoteBase` 41, `helloCc` 41, `selectCc` 42, `viewCc` 43.

### Direct-iPad layout updates

The persistent device Lua is still installed through the serial
`deploy_layout.cjs` path. Once that base receiver is installed, a VSN1 attached
directly to CaptainPad through iPad CoreMIDI receives layout edits without a
serial re-flash:

- CC channel 13 carries eight fixed-width effect names.
- CC channel 14 carries colors, toggle/trigger behavior, and the atomic commit.
- CC channel 15 carries fixed-width mode labels and per-slot mode counts.

`layout_rx.lua` applies fields to shared device globals and repaints only on the
commit CC. The LCD emits a VM-ready hello after its baked globals and the
receiver are initialized; CaptainPad answers by re-sending the complete active
page layout followed by live active/value/mode feedback. This keeps the EAS
Expo/iPad path independent of generated `CaptainPad/ios/` source and of the
engine computer's USB serial port.

### UI lab — rapid on-device iteration

`marsin_engine/tools/vsn1_utils/ui_lab.cjs` flashes experimental LCD screens
to the live device **ephemerally** (replaces the DRAW handler with no
flash-commit, so `--restore` or a power-cycle reverts). Variants live in
`vsn1_utils/variants/`. Used to design a screen before porting it into the
`templates/effects_layout/` production templates. Refuses to open COM12 while
the engine's auto-deploy is mid-flash (single-holder discipline).

## Troubleshooting — "the controller is frozen" (2026-07-10 playbook)

Hard-won from a full day of live debugging. Three distinct faults produce
the same "nothing works" face; triage **in this order**:

### 1. FIRST MOVE: unplug the USB cable, wait 5 s, plug back in

The 8 main pads + the encoder share a hardware scan domain that can **wedge**
— the firmware reads the pads as not-pressed under a physical finger
(`ele[k]:bva()` returns 0) while the 4 small buttons, THE side button, LCD,
LEDs, MIDI-out, and serial all keep working. Signature: **small buttons emit
MIDI, main keys and encoder emit nothing**.

**A machine reboot does NOT clear it** — USB ports keep power through an OS
restart, so the wedged scan survives. Only a physical unplug/replug (true
power cycle) resets it. This is the first debug step for any dead-keys
report, before touching any software.

### 2. Exactly ONE CaptainPad tab

Web MIDI delivers device input to **every** open tab; each live tab
dispatches independently, so two tabs double-toggle every key press
(on+off within ~20 ms = looks completely dead). The launcher auto-opens a
tab on every restart — old tabs pile up. Close every CaptainPad tab (check
BOTH `localhost:6967` and `127.0.0.1:6967` — the newest-boot-wins guard in
`useMidiControl.ts` cannot cross that origin boundary) and keep one.

### 3. Device stuck on a page / side button refuses (purple flash)

An interrupted flash used to leave `page_change_enabled` latched off and/or
the device stranded on the flashed page (both fixed 2026-07-10:
`enablePageChange` now runs in every tool's `finally`, and a live deploy
always re-activates the engine's current page). Field unlock without a
power-cycle:

```bash
cd marsin_engine/tools/vsn1_config && node activate_page.cjs --page 0
```

### Seeing what's actually happening (debug recipe)

The instrumentation that cracked the 2026-07-10 hunt was removed after the
fix, but the recipe is cheap to re-create when needed:

- **Browser side**: temporarily relay `manager.onMessage` raw bytes + connect
  events to an engine `POST /debug/client-log` route that appends JSON lines
  to `~/tmp/bm26_midi_debug.log`; tail the file to see which link of
  `device → browser → engine` is broken. (Keep the relay import-free —
  importing `apiBase` breaks every vitest suite.)
- **Device side**: IMMEDIATE Lua probes over serial make the device
  self-report runtime state as MIDI the relay catches, e.g.
  `gms(15,176,43,<code>)` guarded by the condition under test
  (`if knd then ...`) — no flash writes, invisible to the operator.
- **Two dispatches for one `midi.rx` line = a zombie tab** (see rule 2).

## Known issues (2026-07-10)

### OPEN — initial-load pad wedge (mitigated 2026-07-10 late; root cause = firmware)

**Symptom:** on the FIRST boot deploy after an engine start, the 8 main pads
+ encoder go dead (the "wedged pad-scan" — small buttons, side button, LCD,
LEDs, MIDI-out all keep working). A machine reboot does NOT clear it (USB
keeps power).

**Remedy (hands-free, replaces unplug/replug):**

```bash
cd marsin_engine/tools/vsn1_config && node soft_reset.cjs
```

The grid protocol's `RESET/EXECUTE` is a soft MCU reboot (the grid-editor
"restart module"): the device re-enumerates in ~3 s, the pad scan re-inits,
and the PAGESTORE'd config in NVM survives (verified on hardware
2026-07-10). Physical unplug/replug remains the fallback if serial is dead.

**Auto-mitigation (in-tree):** after any deploy drain that flashed **2+
pages** (the confirmed wedge trigger), `vsn1_layout_deploy.js` automatically
runs `soft_reset.cjs` — so the boot multi-page flash now ends with a fresh
scan; the device's post-reboot hello drives CaptainPad's full resync.
Single-page flashes (proven safe) skip it. Gate:
`vsn1.softResetAfterMultiPage: false` in config.yaml to disable.

**Still to confirm:** the reset was verified to reboot + preserve NVM on a
HEALTHY device; the next time a wedge actually occurs, run `soft_reset.cjs`
INSTEAD of unplugging to confirm it clears the wedged scan too.

**What we know (bisect 2026-07-10 evening, live on hardware):**
- A single-page live flash (`deploy_layout --page N --live`) recovers CLEANLY
  — pads keep working through it. Page-activation-only also fine.
- The wedge correlates with the **boot deploy's back-to-back MULTI-PAGE
  flash** (deploy-on-load flushes every populated page: pages 1→0 in quick
  succession). It reproduced again after a restart.
- NOT our config content (stored Lua is byte-correct) and NOT
  CaptainPad/engine — it's the device's own pad-scan hanging under the rapid
  write+commit+activate burst. Likely a firmware-side scan-init race.
- **Mitigation now in place:** keeping the layout to a SINGLE populated page
  (slots 1–8, page 0) means boot flashes ONE page — fewer back-to-back
  commits, less exposure. Still track a proper fix (e.g. settle delay between
  per-page flashes on boot, or a post-boot pad-scan nudge).

Next debug step: reproduce with the boot double-flash under the serial
instrumentation and bisect which write in the second-page commit wedges the
scan; try inserting a settle delay between per-page `restore_config` spawns in
the deploy-on-load path.

### Reset → view mode (defused)

The device now **defaults to the grid visual** (`vm = 1` in the LCD INIT), so
a VM wipe / reset lands on the normal operator view even if a host re-echo is
missed. Residual: an operator in the READOUT visual may bounce back to GRID
after a re-flash whose echo races the restart — cosmetic, self-heals on the
next resync/keepalive.

### HIGH — auto-deploy on layout change

Make every layout mutation (add / remove / swap / rename) reliably flash and
land back in the drum/grid state. Remove+add cycles verified LIVE 2026-07-10;
a *swap* was reported failing earlier — re-verify.
