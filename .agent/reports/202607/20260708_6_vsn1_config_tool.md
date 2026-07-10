# VSN1 headless config tool — read/round-trip wave

**Date:** 2026-07-08
**Author:** developer agent (Opus)
**Branch:** `feat/party_integration_20260711` (worked in place, no git ops)
**Zone:** `marsin_engine/tools/vsn1_config/` (new, self-contained)

## Goal

Headless programmatic configuration of the Intech VSN1 (Grid module) **without
the Grid Editor GUI**. This wave is **strictly read-only**: build the read /
round-trip half and document the write half. Operator runs uploads himself
(including the LCD Lua) in a later wave.

## What shipped

```
marsin_engine/tools/vsn1_config/
  package.json            standalone; GPL deps isolated as npm deps (gitignored)
  read_config.cjs         read-only device dump tool (implemented + verified)
  README.md               run instructions + full documented WRITE path
  templates/
    hello_world.lua       centered "Hello World" LCD draw (data, not uploaded)
    effects_status.lua     DRAFT effect-name + intensity bar (data, not uploaded)
  dumps/.gitkeep          dump target dir; dumps/*.json gitignored
  .gitignore              node_modules/, package-lock.json, dumps/*.json
```

Git tracks only 7 source files. `node_modules/`, `package-lock.json`, and
`dumps/*.json` are ignored — verified with `git add -n` and `git check-ignore`.
`python scripts/security_check.py --all` → **no leaks**.

## What works (verified)

- **Dependency**: `@intechstudio/grid-protocol` **is on npm**
  (`^1.20260615.942`); no install-from-git needed. Packaging gotcha: its ESM
  `dist/index.js` imports `tslib` but upstream lists `tslib` only as a *dev*
  dep, so a bare install fails at runtime with `ERR_MODULE_NOT_FOUND: tslib`.
  Fixed by declaring `tslib` explicitly in our `package.json`. Package is
  ESM-only, so `read_config.cjs` (CJS) loads it via dynamic `import()`.
- **Port detection**: `--list-ports` correctly flags the VSN1 by USB VID:PID
  `0x303A:0x8123` (== grid-editor `USB_VID_2` / `USB_PID_2`). On this machine
  the VSN1 enumerates as **COM12** (`VID_303A&PID_8123&MI_00`).
- **Full codec + humanize pipeline verified offline**: built a real
  `CONFIG/FETCH` descriptor → `grid.encode_packet()` → valid 48-byte frame
  (SOH/BRC … ETX/EOT/checksum); round-tripped a `CONFIG/EXECUTE` frame back
  through `decode_packet_frame` + `decode_packet_classes` and recovered element,
  event, and `ACTIONSTRING` exactly; `GridScript.humanize()` expands short
  opcodes (`gms` → `midi_send`). The read loop is correct end to end.
- **Element/event enumeration** confirmed against grid-protocol for VSN1L/VSN1R:
  `[0..7]`+`[9..12]` buttons (INIT/BC/TIMER), `[8]` endless (adds ENDLESS),
  `[13]` lcd (INIT/DRAW), `[255]` system (INIT/MAP/TIMER). The element list is a
  256-slot sparse array — the tool skips `undefined` slots and uses the array
  index as `ELEMENTNUMBER`.

## Live read against the device: BLOCKED (port busy)

**A live end-to-end read did NOT complete** — not a tool defect. The **Grid
Editor is running** (5 `grid-editor` processes, window title "Editor") and holds
**COM12 exclusively**. Both attempts failed loudly and correctly:
`Could not open COM12: Access denied ... close the Grid Editor`. Per the task,
this is reported rather than worked around; I did **not** kill the operator's
Grid Editor. **To complete the live dump: close the Grid Editor, then run
`node read_config.cjs --page 0`.** Everything upstream of the exclusive-port
open is verified, so the dump should succeed once the port is free.

## The write sequence (next wave — documented in README, not implemented)

Same codec as read. Per page:

1. *(optional)* `PAGEACTIVE/EXECUTE { PAGENUMBER }` at broadcast `DX/DY=-127` —
   make the page active. (grid-editor `instructions.ts` `ChangePage`.)
2. For each event to change: minify human Lua → short (`GridScript.shortify()` /
   `minifyLua()`), then `CONFIG/EXECUTE { VERSION*, PAGENUMBER, ELEMENTNUMBER,
   EVENTTYPE, ACTIONLENGTH, ACTIONSTRING }`; await `CONFIG/ACKNOWLEDGE`
   (~500 ms). Enforce the `maxScriptLength` guard. (`SendConfig`.)
3. `PAGESTORE/EXECUTE {}` at `DX/DY=-127`; await `PAGESTORE/ACKNOWLEDGE`
   (~3000 ms — flash write). Only PAGESTORE commits to NVM. (`StorePage`.)

On-wire details captured precisely in the README: append `LF` (10) after
`encode_packet().serial` before writing; inbound frames split on `LF` where the
byte 3 back is `EOT` (4); baud 2 000 000. Exact source file/line references for
every instruction are tabulated in the README so the write tool needs no
re-research.

## Licensing

`@intechstudio/grid-protocol` and `grid-editor` are **GPL-3.0** (the npm
"Proprietary" tag is wrong — the tarball's `LICENSE` is GPL v3). GPL code stays
**only in gitignored `node_modules/`** — never vendored/copied into this public
repo. We call the public API; no protocol source, opcode tables, or descriptor
JSON are copied into our tree. Documented as a LICENSE NOTE in the README. Tool
is a pre-playa operator-workstation utility, not part of the offline runtime
bundle.

## Open risks / follow-ups

- **Live dump still owed** once the port is free (see above). Recommend the
  operator run it and confirm the JSON looks right.
- **VSN1 has no per-element "midi rx" event** on the LCD (firmware descriptor:
  LCD exposes only INIT + DRAW). Inbound MIDI is a `system`-level concern.
  `effects_status.lua` is therefore a **DRAFT** with an unverified MIDI→globals
  data path — flagged in-file, not uploaded.
- **LCD draw primitive names/signatures** (`draw_area_filled` /
  `draw_text_fast` / `draw_swap`) are the assumed Grid Lua LCD API and must be
  confirmed against the VSN1 firmware Lua reference before the first real upload;
  operator validates on-device.
- **Multi-page read**: this wave reads one `--page` per run; a full-device dump
  should loop pages using `PAGECOUNT/FETCH` — a small follow-up.
- Stray `HEARTBEAT_INTERVAL …` line printed to stdout on grid-protocol import is
  an upstream `console.log`; harmless, filtered in examples.

---

## Addendum (same day, later): live debug — page 0 + 1 dumps SUCCEEDED

Sina closed the Grid Editor; COM12 opened but the tool timed out waiting for
the heartbeat. Live debug (raw-byte probe on COM12) found the root cause:

**Root cause:** the device broadcasts its heartbeat as **`HEARTBEAT /
EXECUTE`**, not `/REPORT`. The tool's waiter filtered on
`class_instr === 'REPORT'`, so it never matched — heartbeats were arriving
fine every ~250 ms (55-byte frames, checksums valid). Not a DTR issue, not a
framing issue; the raw probe + an offline decode of a captured frame proved
the decoder recovers `HEARTBEAT/EXECUTE {GCCOUNT, HWCFG:59, TYPE, VMAJOR:1,
VMINOR:5, VPATCH:1}` plus a piggybacked `PAGEACTIVE/REPORT {PAGENUMBER:0}`.

**Fix (read_config.cjs):**
1. Heartbeat waiter now matches on class name only (`c.class_name ===
   'HEARTBEAT'`), instr-agnostic.
2. `openPort()` now explicitly asserts `port.set({ dtr: true, rts: true })`
   after open — defensive determinism for USB-CDC across drivers (the coordinator's
   suspect #1; not the culprit here, but cheap insurance and now fail-loud).
3. README updated with the gotcha + root cause; templates upgraded (below).

**Result:** full read-only dumps of the connected module (VSN1L, fw 1.5.1,
hwcfg 59, DX=0 DY=0) — 15 elements, 45 event configs each:

- `dumps/vsn1_VSN1L_page0_2026-07-08T22-15-20-078Z.json`
- `dumps/vsn1_VSN1L_page1_2026-07-08T22-15-30-370Z.json`

**Bonus — the dump killed two open risks.** The factory LCD INIT/DRAW Lua in
page 0 pins down the real LCD API, so the "assumed draw API" risk above is
now resolved:

- `self:draw_area_filled(x1,y1,x2,y2,{r,g,b})`, `self:draw_rectangle_rounded
  [_filled](..., radius, color)`, `self:draw_text_fast(text, x, y, size,
  color)` (text FIRST, glyph advance ≈ size px), `self:draw_swap()`,
  `self:screen_width()`, global `lcd_set_backlight(n)`.
- Inbound data path: factory INIT installs `self.eventrx_cb = function(self,
  hdr, e, v, n)` on the LCD element — values land in `self.v`, a dirty flag
  `self.f` gates DRAW. This replaces the guessed "MIDI→globals" path.

`templates/hello_world.lua` rewritten against the verified signatures;
`templates/effects_status.lua` (still DRAFT, not uploaded) now follows the
factory `eventrx_cb` + dirty-flag pattern. Remaining validation for the draft:
the exact shape of `v` for our routing — on-device, next wave.

No writes were sent at any point: `CONFIG/FETCH` queries only.

---

## Addendum 2 (same day, later): Wave 3 — WRITE half built (dry-run verified)

Sina's priority: "test deploy to the midi controller". Built the write half;
**live device writes remain Sina's to run** — no CONFIG/EXECUTE or PAGESTORE
was ever sent by an agent. Verification stopped at dry-run encoding + offline
round-trip, per the wave brief.

**New files** (zone `marsin_engine/tools/vsn1_config/`):

- `grid_serial.cjs` — shared lib: port discovery, DTR/RTS open, frame
  assembler, decode fan-out, descriptor builders (FETCH/EXECUTE/PAGEACTIVE/
  PAGESTORE), the Lua compile pipeline, hexdump. `read_config.cjs` refactored
  onto it; re-ran a live read afterwards — the fresh dump is **byte-identical**
  to the pre-refactor dump (45/45 entries).
- `write_config.cjs` — writes ONE action string. **Dry-run default**: never
  opens the port; compiles + validates the Lua, prints all three frames
  (hex + params), and proves the CONFIG frame decodes back to the identical
  action string + target. `--live` (operator-only) runs
  PAGEACTIVE/EXECUTE -> CONFIG/EXECUTE (await ACK, 1.5 s) -> PAGESTORE/EXECUTE
  (await ACK, 5 s), failing loudly on any missing ACK with explicit
  "was-it-persisted" guidance. Targets: `--template hello_world` (resolves to
  LCD element 13 / DRAW event 8 from the module map, matching the factory
  dump) or generic `--element N --event KEY --lua file`. Live mode also
  verifies the heartbeat module type matches the resolved target.
- `restore_config.cjs` — the rollback path: replays a `dumps/*.json` (all 45
  action strings + PAGESTORE). Same dry-run default; validates every string
  (length, encode/decode round-trip) before anything is sent; module-type
  guard; on mid-restore ACK failure reports exactly how many writes landed
  and that flash still holds the previous state (no PAGESTORE sent).
- `test_offline.cjs` — 5 offline unit checks, all passing: frame assembler on
  the live-captured heartbeat byte stream, CONFIG/EXECUTE encode/decode
  round-trip, wrapper-fix round-trip across the whole factory dump,
  hello_world compile (108/909 chars, single-line, humanizes back), and the
  length guard firing on oversize input.

**New protocol facts (verified offline against the real package + dump):**

- Device action-string length limit: `grid.getProperty('CONFIG_LENGTH')` =
  **909** (`GRID_PARAMETER_ACTIONSTRING_maxlength`).
- **Wrapper asymmetry:** stored strings are `<?lua ... ?>`; `humanize()` ->
  `<lua ... >`; `shortify()` does NOT restore `<?...?>`. `toDeviceActionString()`
  applies the fix — exact round-trip on 45/45 factory strings.
- `minifyScript()` keeps `--` line comments + their newlines; action strings
  must be single-line, so the pipeline strips line comments first, then
  minifies, then requires single-line + `checkSyntax()` — fail-loud at every
  stage.

**Dry-run of the hello_world deploy: PASSES.** 108/909 chars; the planned
CONFIG frame (157 bytes on wire) decodes back to the identical action string
and target (page 0, element 13, event 8).

**Untested (needs Sina's live run):** real ACK behavior of CONFIG/EXECUTE +
PAGESTORE, and whether the LCD picks up a new DRAW action immediately or only
after a page flip / reboot. The README "TEST DEPLOY" section gives the exact
dump -> dry-run -> live -> verify -> rollback sequence.

`node test_offline.cjs` 5/5 green; live read-only re-check green; security
check (`--all`) still no leaks.

---

## Addendum 3 (same day, later): button_context demo — built + staged; live deploy blocked by permission gate

Sina live-ran the hello_world sequence himself — **LCD showed "Hello World";
the write path is field-proven end to end** (CONFIG/EXECUTE + ACK + PAGESTORE
all behaved as implemented).

Next he asked for a per-key context demo ("make this new template and test
and deploy"): 8 unique key colors; key press -> LCD shows that key's color +
stored value; encoder edits the selected key's value (the effects-surface
selected-slot model); sb0-3 -> pages 0-3.

**Built and fully validated (all offline + dry-run):**

- `templates/button_context/` — 5 snake_case Lua templates: `lcd_init.lua`
  (globals `sel`/`vals`/`cols` + `eventrx_cb` selection/redraw), `lcd_draw.lua`
  (swatch + KEY n + value text/bar, dirty-flag gated), `key_init.lua`
  (per-key LED color, `__R__/__G__/__B__` builder placeholders),
  `endless_edit.lua` (relative mode: `endless_value()-64` delta applied to
  `vals[sel+1]`, clamped 0-127 — pickup-free), `side_button_page.lua`
  (`page_load(element_index()-9)`, press-only guard; ONE template for all 4
  side buttons on ALL 4 pages).
- `build_button_context.cjs` — compiles templates into 4 patch dumps
  (`dumps/patch_button_context_page{0..3}.json`) consumable by the
  field-proven `restore_config.cjs`; cross-checks the KEY_COLORS table
  against `lcd_init.lua`; budget-checks every string (largest: LCD DRAW
  360/909).
- Research nailed the missing semantics from the official docs + factory
  dump: endless relative mode (mode 1 -> 63/65 around 64), `eventrx_cb`
  args (`e = {page, element, event}`), `page_load/page_next` (used natively
  by the factory system MAP), `element_index()` on buttons.
- Fresh rollback dumps of ALL FOUR pages taken first
  (`vsn1_VSN1L_page{0..3}_2026-07-08T22-42-5*.json`; note page 0's LCD DRAW
  currently holds hello_world — the pre-hello factory baseline is the earlier
  `page0_2026-07-08T22-15-20-078Z` dump).
- Dry-runs of all four patches: every action string validated (length +
  encode/decode round-trip). Page order 3->2->1->0 so page 0 ends active.

**Live deploy: NOT performed by the agent.** The coordinator relayed Sina's
authorization, but the session's permission classifier denied the `--live`
write, and per the session rules a coordinator-relayed approval is not user
confirmation for a denied action — so the agent stopped rather than working
around the gate. Everything is staged one command away; the deploy commands
(and a hardware test script) were handed to Sina. This also matches the
tools' design: live writes are operator-gated.

**Untested-on-hardware (flagged in README + templates):** relative-mode
delta scaling with velocity; LED color arg format in key INIT (best-effort
nicety); whether INIT actions take effect without a page flip after deploy.

Security check (`--all`): no leaks.

---

## Addendum 4 (same day, later): demo v2 fixes + deploy_layout.cjs (Track T)

Context: Sina hardware-tested the button-context demo — encoder feel GREAT;
three bugs. This wave fixes them, and builds the effects_v2_midi_layout
Track T deliverable (dossier `.agent/projects/effects_v2_midi_layout.md`).

**Key firmware discoveries (grid-fw `common/src/lua/`, shallow-cloned and
read at source level — these unblock everything):**

- `self.midirx_cb = function(self, header, event)` — per-element MIDI
  receive hook, called by `pass_midi()` (decode.lua); `event = {ch, cmd,
  p1, p2}`, note-off normalized to 144. THE runtime-feedback mechanism.
- Global `ele` element array — cross-element access from any action
  (e.g. `ele[8]:led_value(2, v)` drives the encoder ring from the LCD's
  callback). Ring layer = 2 for endless elements (simplemidi.lua `l={ep=2}`).
- Factory auto-MIDI (simplemidi.lua): key k -> note 32+k, sb0-3 -> notes
  41-44 (matches the dossier's vsn1.yaml pins EXACTLY), encoder turn ->
  CC 40, encoder press -> note 40, all on **channel = (module_y*4 + page)
  % 16** — i.e. channel = page on our single module. Track C should key on
  channel for page attribution.

**Demo v2 fixes (templates/button_context/, rebuilt patches):**

1. Encoder ring tracks the selected key's value (color + brightness), driven
   from both the encoder action and the LCD eventrx (via `ele[8]`).
2. LCD bar: dirty flag is now a GLOBAL poked directly by the encoder action
   (no reliance on endless-event forwarding), and values are floor()ed at
   the source (suspected root cause: undocumented `endless_value()` return
   type — a float in `vals` renders "5.0" and can break integer draw calls).
3. `P<n>` page indicator top-right via `page_current()`.

Discovery while diffing: **pages 1-3 still hold factory sb handlers** —
Sina's live run deployed page 0 only, so page switching only works FROM
page 0 until the new patches land.

**Live deploy: still blocked.** Attempted `restore_config --live` after the
coordinator relayed authorization; the permission classifier denied it,
explicitly noting coordinator/peer authorization cannot clear the block on
writes to the shared physical device. Not worked around. Fresh rollback
dumps of all 4 pages taken (`...T23-16-59/17-00...Z.json`); patches
validated dry-run; the four `--live` commands were handed to Sina.

**deploy_layout.cjs (pinned contract: `node deploy_layout.cjs --layout
<file> [--live]`):** layout JSON (schema v1, documented in README: 32 slots
{id 1-32, effect, name <=12 chars, color}, `midi` feedback block) -> 4
per-page patch dumps -> validated through restore_config dry-run ->
`--live` deploys via restore_config child processes 3->2->1->0. Generated
config per page: key INIT = slot LED color + factory BC verbatim (MIDI
unchanged); sb = local page_load + auto note 41+N; encoder INIT hosts the
`midirx_cb` feedback receiver (value/mode/active CC blocks + page push, all
numbers data-driven from the layout's midi block); encoder turn =
local-predict + relative CC out (engine = source of truth); encoder press =
mode-cycle note out (dossier); LCD = name + value bar + mode index + ON +
page indicator. Largest string 553/909.

Offline tests extended to 7 (`node test_offline.cjs`): layout build
(4 pages x 25 strings, all budgets, per-string encode/decode round-trip,
placeholder substitution) + layout validation rejection cases. All green.
Security check: no leaks.

**Assumptions for Track C (README-documented, data-driven):** feedback CC
map (ch 15; value 0-31, mode 32-63, active 64-95, page 119),
`header[1]==13` USB filter, mode-cycle = note 40 vel>0, key/sb notes on
channel = page.

---

## Addendum 5 (same day, later): cross-page write failure ROOT-CAUSED + fixed; Track C MIDI contract folded in

The coordinator's live deploy failed on the first-ever write to a non-active
page (`PAGEACTIVE page 3` -> `CONFIG el 9` -> "No CONFIG/ACKNOWLEDGE").
Root-caused **from the grid-fw firmware source** (scratchpad clone,
`grid_decode.c` / `grid_ui.c` / `grid_lua_api.c`) — three interlocking facts:

1. `CONFIG/EXECUTE` is **NACKed unless PAGENUMBER == the ACTIVE page**
   (`currentpage` check, grid_decode.c ~1267). The NACKNOWLEDGE reply was
   invisible to our ACK-only filter -> looked like a timeout. (FETCH has no
   page check — which is why our cross-page READS always worked.)
2. **Every accepted CONFIG write sets `page_change_enabled = 0`**; PAGESTORE
   does NOT re-enable it; only an editor heartbeat `TYPE==255` (or reboot)
   does (grid_decode.c ~710, heartbeat handler). While disabled,
   `PAGEACTIVE/EXECUTE` is **silently ignored** (~312) and Lua `page_load()`
   refuses with a purple LED flash (grid_lua_api.c ~1696). Sina's earlier
   page-0 session left the device in exactly this state -> the coordinator's
   PAGEACTIVE(3) was dropped -> CONFIG(page 3) NACKed against active page 0.
3. `page_activepage` updates only when the **async bulk page-load
   completes** (grid_ui.c ~956) — my old 200 ms settle was a race anyway.

**Fix (grid_serial.cjs, inherited by write/restore/deploy_layout):**

- `editorHeartbeatDescriptor()` / `enablePageChange()` — TYPE-255 heartbeat.
- `activatePage(page)` — heartbeat -> PAGEACTIVE -> **wait for the device
  heartbeat's piggybacked `PAGEACTIVE/REPORT {PAGENUMBER==page}`** (the
  ~250 ms beat), loud timeout otherwise.
- `waitForConfigAck()` — resolves on ACKNOWLEDGE, **fails loudly on
  NACKNOWLEDGE** with the firmware's reject conditions spelled out.
- Deploy sessions now END with `enablePageChange()` so the demo's side
  buttons work after the tool disconnects (else: purple-flash dead buttons —
  likely what a user would have hit after any deploy).

Offline: 7/7 tests green; layout patches rebuilt + revalidated.

**Track C contract folded in** (replaces my proposed CC map): feedback on
FIXED channels ch1/ch2 (active notes 32+i ch1, value CC 32+i ch1, mode CC
32+i ch2, page CC 40 ch1, sb LEDs notes 41+p ch1), i over the ACTIVE page,
flat id 8p+i+1. Receiver template + layout schema (`feedbackChannel`,
`modeChannel`, `slotBase`, `pageCc`, `sbNoteBase`) + README rewritten to
match; receiver compiles at 666/909. Key semantic note documented: incoming
feedback is fixed-channel while outgoing device MIDI is channel=page.

**Live deploy: still permission-blocked for the agent** (three denials this
session; the classifier consistently rules coordinator relays are not user
consent for writes to the shared device). The fixed four-command deploy is
ready for Sina; verification plan: re-read all four pages and byte-compare
to the patches (the agent can do that read-only step once deployed).

Security check: no leaks.

---

## Addendum 6 (same day, later): deploy VERIFIED on all 4 pages; PAGESTORE timeout size-scaled

Coordinator (gate cleared for the main loop) deployed the fixed
button-context demo: pages 3/2/1 clean first pass; page 0 hit a PAGESTORE
ACK timeout at 5000 ms once (all 15 CONFIGs ACKed) and fully succeeded on
re-run — validating the activatePage()/NACK fix end to end on hardware.

**Byte-verification (read-only re-dump of all 4 pages,
`...T23-39-5x...Z.json`):**

- page 0: 15/15 deployed strings MATCH; the 30 untouched entries are
  byte-identical to the pre-deploy dump (surgical write confirmed).
- page 1: 4/4 MATCH.  page 2: 4/4 MATCH.  page 3: 4/4 MATCH.
- TOTAL: 27/27 deployed strings byte-match the patch dumps, 0 mismatches,
  0 unintended changes.

**PAGESTORE timeout fix (grid_serial.cjs):** flash-commit time scales with
the number of dirty strings on the page (firmware bulk-store walks every
changed config into littlefs; GC can stall it) — the observed 15-string
timeout at a flat 5 s confirms it. Replaced the flat constant with
`pageStoreTimeout(n) = 10000 + 250*n` ms; restore_config scales by the
page's write count, write_config uses n=1, deploy_layout inherits via
restore (25-string layout pages budget ~16 s). Documented in the README
with the "late ACK — re-read before assuming failure" guidance. Offline
tests still 7/7 green.

---

## Addendum 7 (same day, later): WELCOME screen for the effects layout

Sina feature: on device boot the LCD shows a MarsinLED welcome screen until
the host first talks to it.

**Implementation (templates/effects_layout/, all offline-validated):**

- Global `hi` flag: LCD INIT arms it only when nil (i.e. at boot); once
  cleared it stays cleared across page switches until reboot.
- `lcd_draw.lua` branches on `hi`: welcome = mars-orange disc (rounded rect,
  radius = half size -> circle) over centered "Marsin" (white) + "LED"
  (orange) at size 32, an orange rule under the wordmark, grey
  "welcome aboard" line. Live screen unchanged. Shared clear + draw_swap.
- Exit conditions: (a) ANY recognized feedback message in the midirx
  receiver — including the new dedicated hello — clears `hi` (unrecognized
  MIDI returns early and does not); (b) any main-key press (LCD eventrx
  selection branch) — device usable before the host connects.
- Hello contract (Track C, in flight): CC ch 2 (modeChannel) controller 41
  value 1, emitted on effects-panel load + reconnect alongside the full
  state re-sync. New layout schema field `midi.helloCc` (validated: 0..119,
  must not overlap the mode-CC slot block on the same channel).

Budgets after the feature: receiver 705/909, LCD DRAW 786/909 (the
tightest), LCD INIT max 441/909 — all four page patches validate through
the restore dry-run. Offline tests extended (welcome-flag arm/clear asserts
+ helloCc overlap rejection): 7/7 green. README schema block also brought
fully up to the Track C field names (was still showing the superseded
proposal). NOT live-deployed — dry-run only, per instruction; the
button-context demo stays on the device until Sina's next deploy window.

---

## Addendum 8 (same day, later): full 4-page layout finalized — page flash + 5-LED encoder progress bar

Sina asks folded into the staged effects layout (replaces the button-context
demo as the flashed config once deployed):

1. **All 4 pages carry the full UI** — deploy_layout has always generated
   per-page configs; patches rebuilt for layouts/example_layout.json (pages
   1-3 currently only have a few slots assigned; empty slots show "-" and a
   dim key LED).
2. **Page flash**: page switches now overlay a big centered "P<n>" (size-64
   text, black box, orange rounded border) for an honest 0.5 s. Mechanism:
   LCD INIT re-runs on every firmware page-load — that is the page-switch
   hook — and arms a 20-frame countdown; DRAW decrements it per invocation
   and keeps dirty=1 while it runs. Cadence pinned in firmware:
   GRID_PARAMETER_DRAWTRIGGER_us = 25000 (grid_protocol.h) -> DRAW fires at
   40 Hz -> 20 frames = 0.5 s. No flash at boot (welcome owns first paint);
   flash overlays whichever base screen is active (welcome or live). To fit
   the DRAW budget the welcome artwork moved into LCD INIT as the global
   wdw() function.
3. **Encoder LED progress bar** (replaces single-brightness ring): Sina
   reported the ring not tracking; his "5 controllable LED points" count is
   CONFIRMED in firmware (grid_esp32s3.c: element 8 LED lookup is exactly 5
   entries — {5,6,7,8,9} VSN1L, {0,1,2,3,4} VSN1R). New shared ebar(v) on
   the SYSTEM element INIT (own 909 budget; factory MAP/TIMER untouched):
   5 bands of 20%, below-band LEDs full, above-band off, in-band ramps
   0..255 linearly (b=(v*5-i*127)*255//127 clamped), each LED colored to
   the selected slot on layer 2, addressed via led_address_get(8,i)
   (shortform glag). Called from encoder turn, key-press selection, and
   selected-slot value feedback. Physical fill direction unverified — if
   inverted, flip i -> 4-i (one token).

Budgets: receiver 750/909, LCD DRAW 745/909, LCD INIT max 628/909, system
INIT 219/909. Page patches now 26 strings each (4x26 total). Offline tests
extended (page-flash, wdw, ebar asserts): 7/7 green. All four patches
validate through the restore dry-run. Staged only — live deploy is the
coordinator's (classifier blocks agent --live); verification by re-read
after deploy confirmation.

---

## Addendum 9 (2026-07-09): full layout deploy VERIFIED; Lua-error verdict: transient; timeout re-bumped

Coordinator deployed the full effects layout (pages 3->2->1->0; pages 2 and
0 each needed one idempotent re-run after PAGESTORE timeouts at 16.5 s).

**Byte-verification: ALL FOUR PAGES PASS — 104/104.** Re-read every page
(dumps `...T01-04-5x...Z.json`); all 26 strings per page byte-match the
layout patches. Decisive detail: the firmware serves CONFIG/FETCH from the
LIVE Lua registrations (`grid_ui_event_get_script` uses
`debug.getinfo(ele[n].<event>)`, falling back to the default script if the
handler is missing/broken) — so a byte-exact read-back also proves every
handler is currently registered and callable.

**Lua-error verdict: (a) TRANSIENT mid-deploy artifact.** Evidence:
1. The 104/104 live-registration read-back above (a persistent nil `bc`
   would have returned the default script for that event — none did).
2. 12 s passive wire listen post-deploy: only HEARTBEAT/EXECUTE (48, the
   4 Hz beat) + PAGEACTIVE/REPORT (48); zero checksum drops, zero debug
   traffic — while our LCD DRAW Lua runs at 40 Hz.
3. Mechanism (grid-fw source): `grid_decode_config_to_ui` EXECUTES each
   event right after registering it (`grid_ui_register_script` +
   `grid_ui_process_single`); events dispatch through a Lua queue calling
   `ele[n]:<event>()`. Mid-deploy, a queued `bc` can hit a handler that is
   mid-replacement -> "method 'bc' is not callable (a nil value)" on
   fw 1.5.1 (current fw main's `_events_process` nil-guards this, so it is
   a known-fixed class of race upstream). The error text is firmware debug
   printf traffic interleaved with protocol frames — our reader logs it as
   checksum-mismatch drops; cosmetic.
   A key press today cannot reproduce it: `bc` is registered (proof #1) and
   the wire is clean (proof #2). It can only reappear DURING future deploys
   or page loads, and is harmless.

**Mitigation shipped:** deploy_layout now writes the SYSTEM element (shared
helpers) FIRST within each page (order 255, 0..13) — ordering hygiene so
helpers exist before any later-written action executes mid-deploy (all
callers were already nil-guarded). Content otherwise identical — no
redeploy needed; the deployed device state is verified correct.

**PAGESTORE timeout re-bumped** with the new datapoint (26 strings > 16.5 s
twice): `pageStoreTimeout(n)` = 20000 + 750*n ms (26-string page -> 39.5 s
ceiling). Deploys are rare/pre-playa; false timeouts cost re-runs and
confidence. README updated (late-ACK guidance retained).

Offline tests 7/7 green; patches revalidated; security check no leaks.

---

## Addendum 10 (2026-07-09): device wave — engine layouts, grid LCD, boot-only welcome, knob fix, sticky LEDs

Sina hardware feedback wave. All staged (dry-run + tests green); deploy is
the coordinator's.

**Root causes found (firmware source):**

1. **Welcome-on-page-swap**: the firmware RESTARTS the Lua VM on every page
   load (grid_ui.c bulk_page_load: grid_lua_stop_vm/start_vm) — every
   global, including the welcome flag AND all feedback state
   (vals/mods/acts/selection), is wiped on each swap. Welcome is now gated
   on `os.clock() < 5` (os lib confirmed loaded in the device VM; process
   clock survives VM restarts): boot-only, exactly as asked. CONSEQUENCE
   FLAGGED TO CAPTAINPAD: the host must re-send full feedback on page
   changes or the LCD shows defaults until the next update.
2. **Knob not setting values**: the endless event's function name is `epc`
   (grid_protocol.h), so factory auto-MIDI p2 = epva() = the RELATIVE 63/65
   stream on CC 40 — the host never received an absolute value. Fix: the
   encoder now emits an ABSOLUTE per-slot CC — (0xB0+page), controller
   32+sel, value = the displayed 0..127 — mirroring the feedback numbering,
   stateless for the host. FLAGGED TO CAPTAINPAD: vsn1.yaml must map
   CC 32+k (ch = page) as absolute slot-value set; CC 40 no longer carries
   the value (encoder press = note 40 mode-cycle unchanged).
3. **Page swap slowness**: dominated by the firmware's own VM restart + NVM
   read per page load (fixed cost we cannot touch); our share was the
   page-flash repainting 21 full frames at 40 Hz. The flash now paints
   TWICE (overlay on, overlay off) with a zero-cost countdown between.

**Features staged:**

- `deploy_layout.cjs --from-engine [url]` — builds from the LIVE engine:
  GET /global-effects/layout + /global-effect-slots/status (behavior,
  colors, primaryMode value names). Verified against the running engine
  (6 slots, real modeValues [add, replace, max], Iceberg Flash = trigger).
  Palette fallback for color:null slots; names sanitized/clamped.
- **LCD redesign**: top half = 2x4 slot grid (builder-derived <=4-char
  abbreviations: "5 Hz Punch"->"5HP", "Iceberg Flash"->"IcFl"), selected
  cell filled with its slot color; bottom = full name + value number, MODE
  NAME from the engine (not "M<n>"), ON marker, P<n>, value bar.
- **Sticky toggle LEDs**: toggle slots' key LEDs follow slot-active
  feedback only (their BC no longer touches the LED); trigger slots keep
  the factory momentary tap-flash. 32-entry kind array embedded in the
  receiver from the layout's per-slot behavior.
- Schema v1 extended: per-slot `behavior` + `modeNames` (validated).
  Rendering helpers (grid/flash/welcome/ebar) consolidated on the system
  INIT (750/909); LCD DRAW 776/909, receiver 848/909, all within budget.

Tests 7/7 green (new asserts: os.clock gate, kind-gated sticky LEDs,
absolute value CC, BC variants, helper placement); patches for both
layouts_example and the live-engine layout validate through the restore
dry-run. Fresh pre-deploy rollback dumps taken. Security check: no leaks.

**CaptainPad-side changes needed (routed via coordinator):** (1) map
CC 32+k ch=page as absolute value set; (2) full feedback re-send on page
change (and after reconnect, as today); (3) prompt slot-active feedback on
toggle presses (device no longer self-lights toggle keys).

---

## Addendum 11 (2026-07-09): BLACK-SCREEN REGRESSION root-caused + fixed

Sina: LCD "pretty much all black", no knob value, no page-swap updates.

**Evidence (read-only FETCH diff, page 0):** exactly ONE string on the
device differs from the deployed patch — element 255 (system) INIT is the
PREVIOUS deploy's 219-char ebar-only version; all 25 other strings (incl.
the new LCD INIT/DRAW) byte-match. The LCD DRAW hard-gated on `gdw ~= nil`
(defined only in the new system INIT) -> gdw never existed -> DRAW never
drew -> black screen, no value display, no swap updates.

**Why the el-255 write was lost (firmware source chain):**

1. `page_activepage` is assigned at the START of the bulk page-load
   (grid_ui.c ~956) — the heartbeat's PAGEACTIVE/REPORT confirms the page
   BEFORE the Lua VM restart + NVM read finish. activatePage()'s
   "confirmation" was a false barrier.
2. This wave's reorder made el 255 the FIRST write — it arrived inside the
   still-running page load; `grid_ui_register_script`'s dostring failed
   silently (firmware only debug-prints, grid_ui.c ~402) and **the CONFIG
   ACK does not check registration success** — the device ACKed a lost
   write. Later writes landed after the VM was back.
3. PAGESTORE then faithfully re-stored the OLD live registration for el
   255 (cfg_changed_flag had been set unconditionally).
4. Note: the prior "transient mid-deploy Lua error" (addendum 9) was this
   same race showing its other face.

**Fixes (staged, offline-verified):**

1. `activatePage()` now ends with a TRUE barrier: poll a CONFIG/FETCH probe
   (el 0 INIT) until it REPORTs — a FETCH answer requires the live Lua VM
   (debug.getinfo), so it proves the page load completed. Loud timeout.
2. `restore_config --live` now READ-BACK-VERIFIES every write: after each
   ACK it FETCHes the event and byte-compares — silent registration
   failures abort the deploy on the spot (before PAGESTORE).
3. LCD SELF-SUFFICIENCY: the grid renderer (gdw) moved into the LCD's own
   INIT; DRAW gates only on LCD-INIT state; system-INIT helpers (wdw
   welcome art, fdw flash box, ebar) are optional decorations, nil-guarded
   with fallbacks — a lost system INIT can never black the screen again.
4. WELCOME without os.clock (its runtime on fw 1.5.1 is unprovable
   offline, per the coordinator's suspicion — retired): hi arms on every
   page load and is dismissed by ANY user event type 1..7 — crucially the
   side button's RELEASE, which lands right after a swap — or any host
   feedback; during the page flash the base is the LIVE screen, so swaps
   show content immediately. Boot: nothing dismisses it, wordmark holds.
   Documented edge: a swap whose release event dies in the VM restart and
   with no feedback flowing leaves the welcome until the next touch
   (CaptainPad's page-change re-send closes this fully).

Budgets: LCD INIT 771/909 (p0), LCD DRAW 857/909, system INIT 558/909,
receiver 848/909. Tests 7/7 green; engine + example layouts validate.
Deploy is the coordinator's; after redeploy AND a power cycle, a re-read
must be repeated to confirm NVM persistence (the read-back verify now
guards the RAM path; the reboot check guards the store path).
