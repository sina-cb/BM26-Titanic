-- encoder_init.lua — effects layout, encoder INIT (element 8, event INIT).
--
-- Hosts the module state + the RUNTIME MIDI FEEDBACK RECEIVER. NOTE: the
-- firmware restarts the Lua VM on EVERY page load, so this state is wiped on
-- each page switch — the host must re-send full feedback on page changes
-- (flagged to the CaptainPad track) or the LCD shows defaults until the next
-- feedback lands.
--
-- __KINDS__: builder-embedded 32-entry array (1 = toggle, 0 = trigger) from
-- the layout's per-slot behavior. STICKY TOGGLE LEDs: the active-note
-- feedback drives key LEDs ONLY for toggle slots (sticky ON/OFF state);
-- trigger slots keep their factory momentary tap-flash and ignore active
-- feedback. Toggle keys' local BC no longer touches its own LED at all —
-- the LED state comes exclusively from host feedback (device stays
-- stateless; a press is just select+note out).
--
-- FEEDBACK CONTRACT (Track C; fixed channels, unlike outgoing ch=page):
--   Note On  ch __FCH__ [0x9_, __SB__+i, 127|0]   slot active (toggle LEDs)
--   CC       ch __FCH__ [0xB_, __SB__+i, v]       slot value 0..127
--   CC       ch __MCH__ [0xB_, __SB__+i, m]       slot mode INDEX
--   CC       ch __FCH__ [0xB_, __PCC__, p]        page push -> page_load
--   Note On  ch __FCH__ [0x9_, __SNB__+p, 127|0]  side-button page LEDs
--   CC       ch __MCH__ [0xB_, __HCC__, 1]        HELLO / WELCOME ARM: shows
--                                                 the wordmark (hi = 1). Host
--                                                 sends it exactly ONCE per
--                                                 fresh device connection,
--                                                 NEVER on a page change.
--   CC       ch __MCH__ [0xB_, __VCC__, 0|1]      VIEW MODE echo: 0 DRUM /
--                                                 1 EFFECT. Host-owned; re-
--                                                 pushed after every page-load
--                                                 feedback (survives VM wipe).
--   CC       ch __MCH__ [0xB_, __SCC__, k|127]    SELECT CUE: host-selected
--                                                 key k=0..7 on THIS page
--                                                 (127 = clear). Two-step
--                                                 toggle: first press SELECTS,
--                                                 shown DISTINCT from the
--                                                 sticky active-ON LED.
-- The HELLO arms the welcome (hi = 1); EVERY OTHER recognized message dismisses
-- it (hi = 0). The device INIT defaults hi = 0, so a page-load VM restart shows
-- the live layout immediately — only the host's hello ever brings the logo up.
-- header[1] == 13 filters USB-sourced MIDI (mirrors firmware gmrr).
--
-- SELECT CUE (__SCC__ on __MCH__): value 0..7 = the key index the host has
-- SELECTED (armed for a two-step toggle commit); 127 = SELECT_CUE_NONE
-- (clear). Distinct from the active-ON feedback: the receiver only records
-- the selection in `hsel` (-1 = none); the LCD renders it as a bright cell
-- outline + corner tick in the slot grid and an amber "SEL" marker in the
-- detail area (lcd_init/lcd_draw) — a select indication that reads apart
-- from both the sticky active-ON key LED and the green "ON" text. The cue
-- also snaps the LOCAL `sel` to the selected key so the LCD detail + encoder
-- ring follow the host's selection, matching the on-device two-step model.

vals = vals or {}
mods = mods or {}
acts = acts or {}
sel = sel or 0
-- knd (the 32-entry toggle/trigger array for the sticky-LED gate below) is
-- defined in the KEY INITs (elements 0-7) to keep THIS receiver string under
-- the 909-char budget. INIT ordering across elements on a bulk page load is
-- NOT guaranteed by the firmware, so the gate below nil-guards knd: an
-- unguarded knd[...] on a not-yet-populated table THREW inside midirx_cb,
-- aborting the message BEFORE dirty=1 — the LCD then never repainted again
-- (the "frozen screen, serially alive" bug, audit 2026-07-10). A skipped
-- sticky LED self-heals on the next feedback frame; a dead receiver never
-- does. Guard, don't crash.
dirty = 1
self.midirx_cb = function(self, h, e)
  if h[1] ~= 13 then return end
  local ch, cmd, p1, p2 = e[1], e[2], e[3], e[4]
  local base = page_current() * 8
  if ch == __FCH__ and cmd == 144 then
    local on = (p2 > 63) and 1 or 0
    if p1 >= __SB__ and p1 < __SB__ + 8 then
      local k = p1 - __SB__
      acts[base + k + 1] = on
      -- Sticky toggle LED brightness (color set on layer 1 by the key INIT).
      if knd and knd[base + k + 1] == 1 then
        ele[k]:led_value(1, on * 255)
      end
    elseif p1 >= __SNB__ and p1 < __SNB__ + 4 then
      ele[9 + p1 - __SNB__]:led_value(1, on * 255)
    else
      return
    end
  elseif ch == __FCH__ and cmd == 176 then
    if p1 >= __SB__ and p1 < __SB__ + 8 then
      vals[base + p1 - __SB__ + 1] = p2
      if p1 - __SB__ == sel and ebar ~= nil then ebar(p2) end
    elseif p1 == __PCC__ then
      if p2 ~= page_current() then page_load(p2) end
    else
      return
    end
  elseif ch == __MCH__ and cmd == 176 then
    if p1 >= __SB__ and p1 < __SB__ + 8 then
      mods[base + p1 - __SB__ + 1] = p2
    elseif p1 == __SCC__ then
      -- SELECT CUE: p2 = host-armed key 0..7 (127 = clear). Distinct from the
      -- sticky active-ON LED: the LCD renders `hsel` as a bright armed-cell
      -- outline (lcd_init gdw) + an amber detail name (lcd_draw). Snap `sel`
      -- so the detail area shows the selected slot's name/value/mode.
      hsel = -1
      if p2 < 8 then hsel = p2 sel = p2 end
    elseif p1 == __VCC__ then
      -- VIEW MODE echo: p2 = 0 DRUM / 1 EFFECT (host sends only 0/1). Host-owned
      -- + re-pushed after every page-load feedback so the mode survives the VM
      -- wipe (device defaults 0). lcd_draw reads `vm`: grid in EFFECT, not DRUM.
      vm = p2
    elseif p1 == __HCC__ then
      -- HELLO / WELCOME ARM: host sends this once per fresh device connect
      -- (NEVER on a page change) — the only signal that shows the wordmark.
      hi = 1
      dirty = 1
      return
    else
      return
    end
  else
    return
  end
  -- Any recognized message OTHER than the hello dismisses the welcome.
  hi = 0
  dirty = 1
end
-- DEVICE HELLO (device -> host, 2026-07-10): the firmware restarts the Lua VM on
-- EVERY VM (re)start — power-on, page load, AND every layout re-flash. The moment
-- the receiver above is registered (so nothing races the restart), announce
-- readiness to the host by emitting CC controller __HCC__ = 1 on the current
-- channel (channel = page; the host matches on controller, not channel). CaptainPad
-- treats this as "the device VM is ready — re-push my full state" and re-sends the
-- view mode + all active/value/mode/page feedback; it can't be lost to a restart
-- race because the DEVICE asks only once its receiver is live. The FIRST device
-- hello of a fresh host connection ALSO arms the welcome logo (host tracks a
-- connection generation); every subsequent hello (page load / post-flash) only
-- re-pushes state. NOTE the two DIRECTIONS share controller __HCC__ with no on-wire
-- collision: host->device CC __HCC__ (ch __MCH__) ARMS the welcome (hi=1, handled
-- above); device->host CC __HCC__ is this readiness ping. A device never receives
-- its own sends, and the host filters by direction, so one controller number
-- serves both.
self:midi_send(-1, 176, __HCC__, 1)
