# vsn1_config — headless Intech VSN1 (Grid) configuration over USB serial

Configure the **Intech VSN1** control module (the arcade-style Grid module with a
320×240 LCD) **without the Grid Editor GUI**, by speaking the open Grid serial
protocol directly.

Three tools, one shared protocol lib (`grid_serial.cjs`):

| Tool | What it does | Touches the device? |
|---|---|---|
| `read_config.cjs` | Dump every element/event action string of a page to `dumps/*.json` | Read-only (`CONFIG/FETCH`) |
| `write_config.cjs` | Write ONE action string (template or arbitrary Lua file) | **Dry-run by default**; `--live` writes |
| `restore_config.cjs` | Replay a dump back to the device — the rollback path | **Dry-run by default**; `--live` writes |
| `test_offline.cjs` | Offline unit checks of the codec + builders | Never |

> **Live writes are the operator's call.** Without `--live` the write tools
> never open the serial port: they compile, validate against real device
> limits, print the exact frames (hex + decoded), and prove the frames decode
> back to the intended payload. Nothing mutates the device until a human
> explicitly passes `--live`.

Grid devices are configured over **USB serial (not MIDI)**. Each control element
(buttons, the endless encoder, the LCD, and a virtual `system` element) has a
set of **events** (init, button, encoder, timer, draw, …), each holding a **Lua
action string**, organized into **pages**, persisted with a page-store command.

---

## Licensing note (read before touching deps)

This tool depends on **`@intechstudio/grid-protocol`** and mirrors the request
sequence from **`intechstudio/grid-editor`**. **Both are GPL-3.0.** (The npm
registry metadata mislabels `@intechstudio/grid-protocol` as "Proprietary", but
the `LICENSE` file shipped inside the published tarball is the GNU GPL v3 — the
same as the GitHub repo.)

To keep this **public** repo clean of copied GPL source:

- The GPL packages stay **isolated as ordinary npm dependencies** in this tool's
  own `package.json`. They are pulled into `node_modules/` at install time and
  are **gitignored** — never vendored, copied, or committed into the repo tree.
- We do **not** copy protocol source files, Lua opcode tables, or descriptor
  JSON out of the package into our source. We call the package's public API.
- This directory is a **pre-playa, operator-workstation tool only**. It is not
  shipped to any playa device and is not part of the offline runtime bundle, so
  the "no CDNs / vendored browser deps" offline rule does not apply here — but
  you **must** `npm install` once, on the internet, before the playa (see
  Offline note).

If we ever needed to redistribute this tool as a bundle, the GPL-3 obligations
would attach. For in-repo use as a dev/ops tool calling an installed dependency,
keeping the GPL code in `node_modules/` (uncommitted) is the clean boundary.

---

## Install & run

```bash
cd marsin_engine/tools/vsn1_config
npm install                 # pulls grid-protocol + serialport into node_modules/ (gitignored)

# List serial ports and flag the VSN1 (VID:PID 0x303A:0x8123):
node read_config.cjs --list-ports

# Dump page 0 of the connected VSN1 to ./dumps/ :
node read_config.cjs --page 0

# Force a specific port (skip auto-detect):
node read_config.cjs --port COM12 --page 0
```

Output: a timestamped JSON at
`dumps/vsn1_<TYPE>_page<N>_<ISO-timestamp>.json` containing, for every real
element and every event, the raw short Lua action string **and** its humanized
form.

### `@intechstudio/grid-protocol` is on npm

Yes — published as `@intechstudio/grid-protocol` (this tool pins
`^1.20260615.942`). No install-from-git needed.

**Packaging gotcha (already handled):** the published `dist/index.js` is ESM and
`import`s `tslib`, but upstream lists `tslib` only as a *dev* dependency, so a
bare install of just `@intechstudio/grid-protocol` fails at runtime with
`ERR_MODULE_NOT_FOUND: tslib`. We therefore declare **`tslib`** explicitly in our
`package.json`. Because the package is ESM-only, `read_config.cjs` (CommonJS)
loads it via dynamic `import()` rather than `require()`.

### Offline note

The playa has no internet. Run `npm install` **once, before you leave**, while
online. After that the tool runs fully offline against a locally-connected VSN1.
The Lua humanizer is a bundled WASM module (`@wasm-fmt/lua_fmt`), also vendored
into `node_modules/` by the same one-time install — no network at run time.

### Port-busy / Grid Editor conflict

The serial port is **exclusive**. If the Grid Editor (or any other app) has the
VSN1 open, `read_config.cjs` fails loudly with `Access denied` / port-busy and
tells you to close the Editor. **Close the Grid Editor before running this
tool**, and vice-versa.

---

## How the read path works (implemented)

1. **Find the port** by USB VID:PID `0x303A:0x8123` (Grid ESP32 application),
   or use `--port`.
2. **Open** at **2 000 000 baud** and **explicitly assert DTR + RTS**
   (`port.set({ dtr: true, rts: true })`) — USB-CDC devices can gate TX on DTR;
   don't rely on driver open defaults.
3. **Learn the module type** from the device's `HEARTBEAT` broadcast: `HWCFG`
   → `grid.module_type_from_hwcfg()` → `VSN1L` or `VSN1R`; also gives firmware
   version and the module's `DX`/`DY` position (from the heartbeat's `SX`/`SY`).

   > **Live-verified gotcha (was a real bug):** the device broadcasts its
   > heartbeat as **`HEARTBEAT / EXECUTE`** — *not* `/REPORT` (observed on a
   > VSN1L, fw 1.5.1). A waiter filtering on `class_instr === 'REPORT'` never
   > matches and the tool times out with "No HEARTBEAT received" even though
   > heartbeats arrive every ~250 ms. Match on the class name only. Each
   > heartbeat frame also carries a second class, **`PAGEACTIVE / REPORT`**,
   > announcing the currently active page.
4. **Enumerate** elements with `grid.get_module_element_list(moduleType)` (a
   256-slot array; real elements are the non-`undefined` slots) and events per
   element with `grid.get_element_events(elementType)`.
5. For each `(page, element, event)`, send **`CONFIG/FETCH`** and await the
   matching **`CONFIG/REPORT`**, reading `ACTIONSTRING`.
6. **Humanize** each action string with `GridScript.humanize()` and dump to JSON.

### VSN1 element / event map (from grid-protocol)

```
[0..7]  button   events: INIT(0), BC(3, button-change), TIMER(6)
[8]     endless  events: INIT(0), BC(3), ENDLESS(7), TIMER(6)
[9..12] button   events: INIT(0), BC(3), TIMER(6)
[13]    lcd      events: INIT(0), DRAW(8)
[255]   system   events: INIT(0), MAP(4), TIMER(6)
```

(There is **no** per-element "midi rx" event on the VSN1 LCD in this firmware
descriptor. The factory config instead installs an **`eventrx_cb`** callback on
the LCD element in its INIT action — inbound values land there and DRAW renders
them. See "LCD Lua API" below and the `effects_status.lua` draft header.)

---

## TEST DEPLOY — hello world on the LCD (for Sina)

The safe path: **dump → dry-run → live → verify → rollback**. Close the Grid
Editor first (it holds the port). All commands from this directory.

```bash
# 0. Fresh safety dump of page 0 (rollback source). Factory dumps already
#    exist in dumps/, but take a current one anyway:
node read_config.cjs --page 0

# 1. DRY-RUN the deploy (no serial port touched). Review the frames + the
#    round-trip check output:
node write_config.cjs --template hello_world --page 0

# 2. LIVE deploy (writes ONLY the LCD draw event — element 13, event 8 —
#    everything else untouched; commits with PAGESTORE):
node write_config.cjs --template hello_world --page 0 --live

# 3. Verify on the device:
#    - screen: the LCD redraws when the draw event next fires. KNOWN: the
#      factory draw only renders when its dirty flag is set (a knob/button
#      poke triggers it via eventrx). Our hello_world draws unconditionally,
#      so any draw-event tick should paint it. UNTESTED: whether the firmware
#      runs the new draw action immediately after CONFIG/EXECUTE or only
#      after the next page change/reboot — if the screen still shows the old
#      face, flip pages once (or power-cycle; the write IS persisted).
#    - stored string: re-read and check element 13 / DRAW:
node read_config.cjs --page 0

# 4. ROLLBACK to the pre-deploy state (replays all 45 action strings of the
#    dump + PAGESTORE). Dry-run first, then live:
node restore_config.cjs dumps/vsn1_VSN1L_page0_<your-dump-timestamp>.json
node restore_config.cjs dumps/vsn1_VSN1L_page0_<your-dump-timestamp>.json --live
```

Generic single-event write (same dry-run/live gating):

```bash
node write_config.cjs --element 13 --event DRAW --lua my_draw.lua --page 0 [--live]
```

Caveats (what we KNOW vs what's UNTESTED):

- **KNOWN (live-verified):** the read path, framing, checksums, the
  HEARTBEAT/EXECUTE quirk, the 909-char action limit, and that our encoded
  CONFIG frames decode back byte-identical (offline round-trip vs all 45
  factory strings, `node test_offline.cjs`).
- **UNTESTED (no live write has ever been sent by these tools):** the ACK
  behavior of a real CONFIG/EXECUTE/PAGESTORE, and whether the LCD picks up a
  new DRAW action immediately or needs a page flip / reboot. First live run
  should be exactly the sequence above, with the rollback dump ready.
- The Lua compile pipeline strips `--` line comments; don't put `--` inside a
  Lua string literal (the syntax check will fail loudly if that breaks code).

---

## The WRITE path (protocol reference — implemented in write_config.cjs)

Everything below is the exact sequence the Grid Editor uses to write config and
persist it, and what `write_config.cjs` / `restore_config.cjs` implement.

### Packet codec (same for read and write)

`@intechstudio/grid-protocol` `grid.encode_packet(descriptor)` builds the
on-wire byte array; `grid.decode_packet_frame()` + `grid.decode_packet_classes()`
parse inbound frames.

- **Frame structure** (`dist/index.js` `encode_packet`, ~line 3918): `SOH`(1) +
  `BRC`(15) header block + `EOB`, then a class block `STX`(2) + 3-char class code
  + 1-char instr code + class params + `ETX`(3), then `EOT`(4), then a 2-char XOR
  checksum. The `LEN` field in the BRC header is back-patched to the total
  length. `encode_packet` returns `{ serial, id }`.
- **On the wire**, append a **`LF` (byte 10)** after `encode_packet().serial`
  before writing to the port. Reference: grid-editor
  `src/renderer/runtime/engine.store.ts` — `retval.serial.push(10)` then
  `transport.write(new Uint8Array(serial))`.
- **Inbound framing**: a complete frame ends at a byte `10` (LF) **whose byte 3
  positions earlier is `4` (EOT)**. Reference: grid-editor
  `src/renderer/serialport/serialport.ts` `setupFrameHandler()`
  (`rxBuffer[i] === 10 && rxBuffer[i - 3] === 4`). `read_config.cjs`'s
  `FrameAssembler` implements exactly this.

### Write one event's Lua: `CONFIG / EXECUTE`

Reference: grid-editor `src/renderer/serialport/instructions.ts`, class
`SendConfig` (~line 118). Descriptor:

```js
{
  brc_parameters: { DX, DY },          // module position from its HEARTBEAT
  class_name: "CONFIG",
  class_instr: "EXECUTE",              // EXECUTE = write (FETCH = read)
  class_parameters: {
    VERSIONMAJOR, VERSIONMINOR, VERSIONPATCH,   // grid.getProperty("VERSION")
    PAGENUMBER,                        // target page
    ELEMENTNUMBER,                     // element index (0..13, or 255 = system)
    EVENTTYPE,                         // event value from get_element_events()
    ACTIONLENGTH: config.length,       // length of the SHORT (minified) Lua
    ACTIONSTRING: config,              // the short Lua action string
  },
}
```

- Expect a **`CONFIG / ACKNOWLEDGE`** reply (filter on class_name=CONFIG,
  class_instr=ACKNOWLEDGE, matching `SX/SY`). Editor uses `responseTimeout: 500`.
- **Minify + shortify first — with the wrapper fix.** The device stores the
  *short* form wrapped **`<?lua ... ?>`**. `GridScript.humanize()` maps that to
  `<lua ... >`, but `GridScript.shortify()` does **not** restore the `<?...?>`
  wrapper — you must re-wrap yourself (`toDeviceActionString()` in
  `grid_serial.cjs`; validated as an exact round-trip on all 45 factory
  page-0 strings). Also: action strings are single-line — strip `--` line
  comments before minifying, or a joined line comment eats the rest of the
  code (`buildActionStringFromLua()` handles this and syntax-checks after).
- **Length guard.** The device limit is `grid.getProperty('CONFIG_LENGTH')`
  = **909** chars (`GRID_PARAMETER_ACTIONSTRING_maxlength`). grid-editor
  rejects configs `>= Grid.Protocol.maxScriptLength`; enforce the same bound
  and fail loudly.

### Select the page being edited: `PAGEACTIVE / EXECUTE`

Reference: `instructions.ts` class `ChangePage` (~line 224).

```js
{
  brc_parameters: { DX: -127, DY: -127 },   // broadcast to all modules
  class_name: "PAGEACTIVE",
  class_instr: "EXECUTE",
  class_parameters: { PAGENUMBER: page },
}
```

`DX/DY = -127` is the broadcast address (grid-editor uses it for global page
changes). Page count can be queried with `PAGECOUNT / FETCH` (→ `PAGECOUNT /
REPORT`).

> **THE cross-page write gotcha (root-caused in grid-fw `grid_decode.c` /
> `grid_ui.c` / `grid_lua_api.c` after a live failure):**
>
> 1. **`CONFIG/EXECUTE` is NACKed unless its `PAGENUMBER` equals the ACTIVE
>    page** (`currentpage` check in `grid_decode_config_to_ui`). A
>    `CONFIG/NACKNOWLEDGE` comes back — filter for it or it looks like
>    silence. (`CONFIG/FETCH` has no such check: reads work cross-page.)
> 2. **Every accepted CONFIG write sets `page_change_enabled = 0`**
>    (unsaved-changes lock). `PAGESTORE` does NOT re-enable it. Only an
>    **editor-style heartbeat `HEARTBEAT/EXECUTE {TYPE: 255, HWCFG: 255}`**
>    (or a reboot) re-enables. While disabled: `PAGEACTIVE/EXECUTE` is
>    **silently ignored** (no reply of any kind) and on-device Lua
>    `page_load()` refuses with a **purple LED flash**.
> 3. **The active page only updates when the async bulk page-load
>    completes** (`page_activepage = bulk_last_page` at bulk end) — a fixed
>    settle delay is a race; instead wait for the device heartbeat's
>    piggybacked `PAGEACTIVE/REPORT {PAGENUMBER}` (~every 250 ms) to
>    announce the target page.
>
> **Mid-deploy Lua-error noise (expected, harmless):** the firmware EXECUTES
> each event action immediately after a CONFIG write registers it, and its
> event dispatcher can transiently invoke a handler that is mid-replacement —
> observed on fw 1.5.1 as serial debug text ("LUA not OK! ... method 'bc' is
> not callable (a nil value)") interleaved with protocol frames (surfacing as
> checksum-mismatch drops in our reader). It is a deploy-time artifact only:
> post-deploy FETCH reads come from the live Lua registrations
> (`debug.getinfo`), so a byte-exact re-read proves every handler ended up
> registered and callable. deploy_layout also writes the system element
> (shared helpers) FIRST within each page as ordering hygiene.
>
> `grid_serial.cjs` encapsulates the correct dance as `activatePage()`
> (heartbeat → PAGEACTIVE → confirm via report) and `waitForConfigAck()`
> (ACK or loud NACK), and deploy sessions end with `enablePageChange()` so
> the side buttons keep working after the tool disconnects. write/restore/
> deploy_layout all use this path.

### Persist to flash: `PAGESTORE / EXECUTE`

Reference: `instructions.ts` class `StorePage` (~line 341).

```js
{
  brc_parameters: { DX: -127, DY: -127 },
  class_name: "PAGESTORE",
  class_instr: "EXECUTE",
  class_parameters: {},
}
```

- Expect **`PAGESTORE / ACKNOWLEDGE`** (with a `LASTHEADER` param). Editor uses
  `responseTimeout: 3000` — but **commit time scales with the number of dirty
  strings on the page** (the firmware bulk-store walks every changed config
  into littlefs; NVM garbage collection can stall further): a 15-string page
  was observed to blow a flat 5 s timeout once and pass on re-run. Our tools
  therefore use a size-scaled wait — `grid_serial.cjs pageStoreTimeout(n)` =
  **10 000 ms base + 250 ms per written string** (a 25-string layout page
  budgets ~16 s). If it still times out, the store may have completed with a
  late ACK — re-read the page before assuming failure, then re-run.
- `CONFIG/EXECUTE` writes stage changes into the device's working page; **only
  `PAGESTORE` commits them to non-volatile memory.** Without it, changes are lost
  on power cycle.

### Recommended full write sequence (per page)

```
(optional) PAGEACTIVE/EXECUTE  page N            -- make page N active
for each element, for each event you are changing:
    minify the human Lua -> short Lua
    CONFIG/EXECUTE  { page N, element, event, ACTIONSTRING=short }
    await CONFIG/ACKNOWLEDGE
PAGESTORE/EXECUTE                                 -- commit page N to flash
await PAGESTORE/ACKNOWLEDGE (timeout 3000 ms)
```

Related instructions available in `instructions.ts` if needed:
`PAGECLEAR` (wipe a page), `PAGEDISCARD` (drop unsaved changes), `NVMERASE`
(factory-wipe — dangerous), `IMMEDIATE/EXECUTE` (`SendConfigImmediate`, run Lua
once without storing — useful for a "preview" of the LCD hello-world before
committing).

### Source-of-truth files (all GPL-3, read in `node_modules/` / GitHub)

| What | File |
|---|---|
| Packet encode/decode, element & event tables, humanize/minify | `@intechstudio/grid-protocol` → `dist/index.js`, `dist/string-operations.d.ts`, `dist/lua-formatter.d.ts` |
| Instruction descriptors (FETCH / EXECUTE / PAGEACTIVE / PAGESTORE / …) | grid-editor `src/renderer/serialport/instructions.ts` |
| On-wire LF terminator + write call | grid-editor `src/renderer/runtime/engine.store.ts` |
| Inbound frame split rule (EOT+LF) | grid-editor `src/renderer/serialport/serialport.ts` (`setupFrameHandler`) |
| Baud rate, VID:PID filters | grid-editor `src/renderer/serialport/serial-transport.ts`, `serialport.ts`, `configuration.json` |
| The per-element fetch call site | grid-editor `src/renderer/runtime/runtime.ts` (`FetchConfig`, `load()`) |

---

## Templates (`templates/`)

Lua **data files** — inputs to the write tools, never auto-uploaded.

- **`hello_world.lua`** — centers "Hello World" on the 320×240 LCD via
  `self:draw_area_filled` / `self:draw_text_fast` / `self:draw_swap`. Intended
  as the LCD element's `DRAW` action. **Field-proven** (live-deployed by the
  operator; LCD rendered correctly).
- **`effects_status.lua`** — **DRAFT.** Renders a selected-effect name + an
  intensity bar from values received via the LCD element's `eventrx_cb`
  callback (the factory inbound-data pattern). Draw calls are verified; the
  value routing still needs on-device validation — flagged in the file header.
  Do not upload as-is.
- **`button_context/`** — the per-key context demo (see next section).

## button_context demo — per-key color + value, encoder edits selection

The prototype of the effects-surface **selected-slot model**, as a VSN1 demo:

- Each of the 8 main keys (elements 0–7) has a unique color. Pressing a key
  selects it: the LCD shows a big swatch in that key's color, `KEY n`, and the
  key's own stored value (text + bar). Each key's LED is set to its color
  (best-effort; untested arg format mimicked from the factory BC action).
- The endless encoder (element 8, **relative mode**: `endless_value()` reports
  64±delta per the official endless-mode docs) edits the **selected** key's
  stored value, clamped 0–127 — pickup-free across selection changes.
- Side buttons sb0–sb3 (elements 9–12) jump to pages 0–3 via
  `page_load(self:element_index() - 9)`, **deployed to all four pages** so you
  can always navigate back. The module's physical utility button (system MAP:
  `page_load(page_next())`) remains the native fallback.
- Cross-element state lives in Lua globals (`sel`, `vals`, `cols`) set up by
  the LCD INIT; the LCD `eventrx_cb` moves the selection on key events and
  pokes the dirty flag (`self.f`) so DRAW repaints — the factory redraw
  pattern. `vals` survives page trips (`vals = vals or {...}`).

Build + deploy (patches go through the field-proven `restore_config.cjs` path,
dry-run by default; deploy pages 3→2→1→0 so page 0 ends active):

```bash
node build_button_context.cjs        # compiles templates -> dumps/patch_button_context_page{0..3}.json
node restore_config.cjs dumps/patch_button_context_page3.json          # dry-run
node restore_config.cjs dumps/patch_button_context_page3.json --live   # deploy
# ... same for page2, page1, page0
```

Rollback: restore the pre-deploy full-page dumps from `dumps/` (take fresh
ones with `read_config.cjs --page N` before deploying).

Untested-on-hardware notes: relative-mode delta scaling with velocity; the
LED color arg format in `key_init.lua`; whether new INIT actions take effect
without a page flip (if the screen looks stale after deploy, press sb0 or
flip pages once — the flash write is already committed).

**v2 fixes (after Sina's hardware pass — encoder feel confirmed GREAT):**

1. **Encoder ring tracks the selected value** — the encoder action and the
   LCD `eventrx_cb` now drive the ring via `self:led_value(2, value*2)` /
   `ele[8]:led_value(2, ...)` (layer 2 = endless ring, per grid-fw
   `simplemidi.lua`'s `l = {ep = 2}`), colored to the selected key.
2. **LCD bar follows the encoder** — two-pronged fix: the dirty flag is now a
   GLOBAL (`dirty`, poked directly by the encoder action, no dependence on
   endless-event forwarding), and values are `math.floor`ed at the source
   (`endless_value()`'s type is undocumented; a float in `vals` renders as
   "5.0" and can break integer-expecting draw calls — the suspected bug).
3. **Page indicator** — DRAW paints `P<n>` (via `page_current()`) top-right.

Key firmware facts backing these (grid-fw `common/src/lua/`): global **`ele`**
element array (cross-element access from any action), element-scoped
`led_value(layer, 0..255)`, and `self.midirx_cb(self, header, event)` — the
per-element MIDI receive hook (`pass_midi` in `decode.lua`), with
`event = {ch, cmd, p1, p2}` and note-off normalized to note-on.

## deploy_layout.cjs — the effects layout pipeline (Track T)

Dossier: `.agent/projects/effects_v2_midi_layout.md`. The engine owns a
32-slot layout (4 pages × 8); on layout change it invokes this tool as a
child process (pinned contract):

```bash
node deploy_layout.cjs --layout <file.json> [--live] [--port <name>]
node deploy_layout.cjs --from-engine [http://127.0.0.1:6968] [--live]
node deploy_layout.cjs --from-engine --page N [--live]   # re-flash ONE page (fast)
```

`--page N` (0..3) deploys only that page — the fast path the engine's
auto-deploy hook uses when a single slot changes (~1 page instead of 4).
Dry-run default + per-write read-back verify still apply.

`--from-engine` builds the layout from the LIVE engine: `GET
/global-effects/layout` (slot placement + display names) merged with `GET
/global-effect-slots/status` (per-slot `behavior` toggle|trigger, colors,
and the effect's `primaryMode` **value names** — shown on the LCD instead of
mode indexes). Engine slots with `color: null` fall back to the built-in
palette by key position. Names/mode names are sanitized (quotes stripped,
length clamped) for the on-device Lua literals.

Dry-run (default): validates the layout, compiles all ~41 action strings,
budget-checks each against the 909-char limit, writes
`dumps/layout_<name>_page{0..3}.json`, and validates every patch through
`restore_config.cjs`'s dry-run (encode/decode round-trip). `--live` deploys
the four patches via `restore_config.cjs --live` child processes, pages
3→2→1→0 (page 0 ends active), failing loudly on the first bad exit.
**Runtime value/mode/active changes are MIDI feedback, never layout deploys**
(dossier: knob twists never cause flash writes). CaptainPad also has a
direct-iPad runtime layout stream for a VSN1 connected through CoreMIDI:
reserved CC channels update the active page's names, colors, behavior, and mode
labels, followed by an atomic commit. `layout_rx.lua` receives that stream.
Serial remains the one-time persistent/base-Lua deployment path; runtime layout
state is re-sent after the LCD's VM-ready hello.

### Layout schema (version 1, JSON)

```jsonc
{
  "version": 1,
  "name": "example",            // snake_case; used in patch filenames
  "module": "VSN1L",            // or VSN1R; enforced against the device at deploy
  "midi": {                     // feedback contract (engine -> device) — Track C pins
    "feedbackChannel": 1,       // ch for active notes, value CCs, page CC
    "modeChannel": 2,           // ch for mode CCs and the hello CC
    "slotBase": 32,             // note/CC base + i (i = 0..7, ACTIVE page slots)
    "pageCc": 40,               // page push: page_load(value)
    "sbNoteBase": 41,           // side-button page LED notes 41..44
    "helloCc": 41               // host-connected hello (exits the welcome screen)
  },                            // blocks must not overlap; see validateLayout()
  "slots": [                    // 1..32 entries; missing ids = empty slot
    { "id": 1,                  // 1..32; page = (id-1)//8, key = (id-1)%8
      "effect": "freeze_frame", // engine effect id (informational on-device)
      "name": "Freeze",         // 1..12 chars, no quotes/backslashes (LCD width)
      "color": [255, 40, 40],   // key LED + LCD accent
      "behavior": "toggle",     // toggle (sticky feedback LED) | trigger
                                //   (factory momentary tap-flash); default toggle
      "modeNames": ["HOLD"] }   // engine primaryMode value names (<=10 chars
                                //   each) shown on the LCD; [] = effect has none
  ]
}
```

### Device-side behavior (generated per page)

- **Keys 0–7**: INIT sets the LED to the slot color (empty = dim grey); BC is
  the **factory string verbatim** — key MIDI unchanged (auto: note `32+k`,
  **channel = current page**, so the engine distinguishes pages by channel).
- **sb0–3**: local `page_load(N)` for instant response + factory-auto note
  `41+N` out (dossier's vsn1.yaml page-select contract). Engine page pushes
  come back on `pageCc`.
- **Encoder**: turn = local-predict edit of the selected slot's value; the
  device emits an **ABSOLUTE per-slot value CC**: `CC (0xB0+page),
  controller 32+sel, value 0..127` — mirroring the host->device value-CC
  numbering, stateless for the host. **KNOB-BUG FIX**: the endless event's
  firmware function name is `epc`, so auto-MIDI p2 (`epva()`) sent the
  RELATIVE 63/65 stream on CC 40 — the host never saw an absolute value.
  Press = mode-cycle **note 40** out, unchanged (that path works).
- **LCD**: TOP = a 2x4 grid of the page's 8 slots (builder-derived <=4-char
  abbreviations; the selected cell is filled with its slot color). BOTTOM =
  full effect name + value number, the mode NAME (engine primaryMode value;
  "-" if none/no feedback), `ON` marker, `P<n>`, and the value bar.
- **Sticky toggle LEDs**: key LEDs of `behavior: toggle` slots follow the
  host's slot-active feedback (sticky ON/OFF); their local BC never touches
  the LED (device stateless — press = select + note out; CaptainPad decides
  select-vs-toggle). `trigger` slots + empty keys keep the factory momentary
  tap-flash. The 32-entry kind array is embedded in the receiver.
- **Lua VM resets on EVERY page load** (grid-fw `grid_ui.c` bulk_page_load
  stops/starts the VM): all globals — including vals/mods/acts and the
  selection — are wiped on page switch. **The host must re-send full
  feedback on page changes** or the LCD shows defaults until the next
  update. This was also the welcome-on-page-swap bug: the boot flag died
  with the VM. Welcome is now gated on `os.clock() < 5` (the `os` lib is
  loaded in the device VM; the process clock survives VM restarts), so the
  wordmark shows only in the first ~5 s after power-on.
- **Page flash is 2 paints, not 21**: the overlay paints once, the 0.5 s
  countdown ticks with zero render cost, and one final repaint clears it —
  the flash overlays the page without weighing down the page load (the rest
  of perceived swap latency is the firmware's own VM restart + NVM read).
- **Encoder LED progress bar**: the endless element has **exactly 5 LEDs**
  (grid-fw `grid_esp32s3.c`: lookup `{5,6,7,8,9}` on VSN1L / `{0,1,2,3,4}`
  on VSN1R). The selected slot's value 0..127 renders as a fill-from-bottom
  bar in 5 bands of 20%: LEDs below the current band fully lit, above off,
  and the in-band LED ramps 0..255 linearly within its 20% span
  (`b = (v*5 - i*127)*255 // 127`, clamped). Each LED gets the selected
  slot's color on layer 2. Shared `ebar(v)` lives on the SYSTEM element's
  INIT (own 909 budget) and is called from encoder turn, key-press
  selection, and selected-slot value feedback. If the physical order is
  inverted on hardware, flip `i` -> `4 - i` in `led_address_get(8, i)`.
- **Page flash**: on every page switch the incoming page's LCD INIT arms a
  20-frame countdown (`pf`); DRAW overlays a big centered "P<n>" (size-64
  text in a black box with an orange rounded border) and keeps repainting
  until it expires. The DRAW event fires every 25 ms (firmware
  `GRID_PARAMETER_DRAWTRIGGER_us = 25000`, 40 Hz), so 20 frames = an honest
  0.5 s. No flash on boot — the welcome screen owns the first paint.
- **Welcome screen**: on device boot the LCD shows the MarsinLED wordmark
  (mars-orange disc over centered "Marsin" white + "LED" orange at size 32,
  an orange rule, and a grey "welcome aboard" line) instead of the live
  status. It exits on the FIRST recognized CaptainPad feedback — the
  dedicated hello CC or any state message — or on a main-key press (device
  usable before the host connects). The flag is the global `hi` (nil only
  at boot -> armed; cleared once, stays cleared across page switches until
  reboot).
- **Feedback receiver** (`midirx_cb` on the encoder element, own 909 budget):
  implements the Track C contract below; filters `header[1] == 13` (USB
  source, mirroring the firmware's own `gmrr` helper — UNTESTED on hardware).

### MIDI feedback contract — PINNED BY TRACK C (CaptainPad → device)

CaptainPad emits diffed sends, full re-send on reconnect. `i` = 0..7 over
the **ACTIVE page's** slots; flat slot id = `8*page + i + 1`. **Incoming
feedback uses FIXED channels** — unlike the device's outgoing auto-MIDI
where channel = page — so the receiver matches on channel + number:

| Meaning | Message | Layout field |
|---|---|---|
| Slot active (+ key LED) | Note On ch 1 `[0x91, 32+i, 127\|0]` | `feedbackChannel`, `slotBase` |
| Slot value (intensity) | CC ch 1 `[0xB1, 32+i, round(v*127)]` | `feedbackChannel`, `slotBase` |
| Slot mode index | CC ch 2 `[0xB2, 32+i, mode]` | `modeChannel`, `slotBase` |
| Current page index | CC ch 1 `[0xB1, 40, page]` → device `page_load()`s | `pageCc` |
| Side-button page LEDs | Note On ch 1 `[0x91, 41+p, 127\|0]` | `sbNoteBase` |
| Hello (host connected) | CC ch 2 `[0xB2, 41, 1]` — sent on effects-panel load + reconnect; exits the welcome screen | `helloCc`, `modeChannel` |

Still untested on hardware: the `header[1] == 13` USB filter, and page-follow
via `pageCc` (requires page changes enabled — the deploy tools re-enable
them on exit, but any subsequent CONFIG write disables them again until the
next deploy/heartbeat).

Device → engine (outgoing, unchanged factory auto-MIDI): key notes `32+k`,
sb notes `41+N`, encoder CC/note 40, all on **channel = page** (`ch =
(module_y*4 + page) % 16`) — sb notes 41–44 match the dossier's vsn1.yaml
pins exactly. Mode-cycle = note 40 velocity > 0.

### LCD Lua API (verified from the live device dump)

The page-0 dump of the factory VSN1L config contains the stock LCD INIT/DRAW
code, which pins down the real API (method calls on `self`, colors as
`{r, g, b}` tables):

```
lcd_set_backlight(0..255)                            -- global, INIT
self:screen_width()                                  -- 320
self:draw_area_filled(x1, y1, x2, y2, color)
self:draw_rectangle_rounded(x1, y1, x2, y2, radius, color)
self:draw_rectangle_rounded_filled(x1, y1, x2, y2, radius, color)
self:draw_text_fast(text, x, y, size, color)         -- text FIRST; a glyph
                                                     --   advances ~`size` px
self:draw_swap()                                     -- present back buffer
self.eventrx_cb = function(self, hdr, e, v, n) ... end
                                                     -- inbound values -> LCD;
                                                     --   v = value array,
                                                     --   n = name string
```

The factory DRAW gates rendering on a dirty flag (`self.f`) that `eventrx_cb`
sets — follow that pattern for anything that redraws on incoming data.
