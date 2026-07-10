-- lcd_init.lua — effects layout, LCD INIT (element 13, per page).
--
-- SELF-SUFFICIENT: everything the live screen needs (data + the two renderers
-- gdw/ddw) lives HERE, on the LCD's own budget — a lost/failed system INIT can
-- no longer black the screen (that exact failure shipped once: the system
-- element's write was silently lost mid-page-load and the DRAW gate on its
-- helper never passed). System-INIT helpers (welcome art, flash box, ebar) are
-- optional decorations, nil-guarded at call sites.
--
-- BUILDER TEMPLATE: __NAMES__ / __COLORS__ / __MODES__.
--
-- WELCOME (host-armed, 2026-07-09 — the true model): the firmware restarts the
-- Lua VM on EVERY page load (indistinguishable on-device from power-on), so this
-- INIT can NOT tell a fresh device connect from a page switch. It therefore
-- defaults hi = 0 — the LIVE layout paints immediately on any page load, and the
-- wordmark NEVER re-appears on a page change. The HOST arms the welcome exactly
-- once per fresh device connection: CaptainPad's VSN1 feedback path sends the
-- dedicated hello (CC ch __MCH__ cc __HCC__ value 1) only on a genuine device
-- (re)connect / first sync, never on a page change (see encoder_init.lua midirx +
-- CaptainPad vsn1_feedback WELCOME). The receiver sets hi = 1 on that hello; ANY
-- recognized user event (types 1..7) or any other host feedback dismisses it back
-- to hi = 0. So the logo shows on the initial power-on/connect and holds until
-- first touch or the first non-hello feedback, and a page swap shows content
-- instantly. NOTHING in any INIT sets hi = 1.
--
-- PAGE FLASH: pf = 20 DRAW frames (25 ms firmware cadence) = 0.5 s; pd is the
-- painted-once flag (2 paints total; see lcd_draw.lua).
--
-- ONE VIEW (Sina, 2026-07-10 evening): DRUM behavior + GRID visual. Every key
-- press fires immediately (host-side contract), and the LCD always shows the
-- 2x4 COLOR grid (colors only — no per-cell text) with the pressed effect's
-- compact detail line under it. The vm flag survives as the render selector
-- (1 = grid visual) so the dormant full-screen readout stays reachable for a
-- post-party revisit; it DEFAULTS 1 here and the host echo re-pins 1 (ch
-- __MCH__ cc __VCC__) on every re-sync, so a VM wipe always lands on the grid.

lcd_set_backlight(255)
nms = __NAMES__
cls = __COLORS__
mnm = __MODES__
-- knd (the 32-entry toggle/trigger array) rides the KEY INITs (which have
-- room), keeping this element well under 909 for dense 8-slot pages. All INITs
-- run on every page load before any MIDI, so the encoder receiver's `knd[...]`
-- is always populated regardless of which INIT defines it.
sel = 0
hsel = -1
hi = 0
vm = 1
pf = 20
pd = 0
dirty = 1
-- gdw: the slot grid — 8 cells (2 rows of 4, matching the 8-key layout), each
-- its slot's COLOR rectangle, COLORS ONLY (per-cell text dropped 2026-07-10 —
-- Sina wants a clean color field; names live on the detail line below). The
-- pressed/selected cell (hsel via the host select cue, -1 = none) gets a
-- CONTRAST border (black on a light cell / white on a dark one, the weighted
-- 3:6:1 luminance test) so the current target reads at a glance.
-- Cell brightness follows ACTIVE state (host feedback `acts`, per flat slot):
-- an ON slot draws its full color, an OFF slot the SAME color dimmed to 40%
-- (d=4/10) — the operator reads on/off at a glance while the palette stays
-- recognizable. The selected cell (hsel) still gets its contrast border on top,
-- computed from the FULL color so the border stays stable regardless of dim.
gdw = function(s)
  local pb = page_current() * 8
  for i = 0, 7 do
    local x, y, q = (i % 4) * 80, (i // 4) * 53, cls[i + 1]
    local d = ((acts or {})[pb + i + 1] or 0) > 0 and 10 or 4
    s:draw_area_filled(x + 2, y + 2, x + 78, y + 51, {q[1] * d // 10, q[2] * d // 10, q[3] * d // 10})
    if i == hsel then
      local t = (q[1] * 3 + q[2] * 6 + q[3] > 1280) and {0, 0, 0} or {255, 255, 255}
      s:draw_rectangle_rounded(x + 2, y + 2, x + 78, y + 51, 3, t)
    end
  end
end
self.eventrx_cb = function(self, hdr, e, v, n)
  if e[3] > 0 and e[3] < 8 then hi = 0 end
  if e[3] == 3 and e[2] <= 7 then
    sel = e[2]
    if ebar ~= nil then ebar((vals or {})[page_current() * 8 + sel + 1] or 0) end
  end
  dirty = 1
end
