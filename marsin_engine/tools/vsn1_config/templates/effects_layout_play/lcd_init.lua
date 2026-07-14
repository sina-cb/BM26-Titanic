-- lcd_init.lua — effects layout PLAY profile, LCD INIT (element 13, page 0).
--
-- PLAY is the big-cell PERFORMANCE surface (effects_v2 PLAY/EDIT split). It is a
-- pure performance readout — NOT the detail-edit screen — so there is no
-- per-slot value/mode detail line here (that lives on the EDIT surface's
-- lcd_init + key-INIT dtl). Instead the whole screen is a 2x4 grid of LARGE
-- color cells, one per page-0 slot, each labelled with its slot name; an ACTIVE
-- slot draws at full brightness with a bright ring (oversized active state for a
-- stage-readable surface), an inactive slot dims to ~30%.
--
-- SHARED vs OVERRIDDEN: PLAY only overrides the templates that DIFFER — this
-- LCD INIT, lcd_draw, and encoder_press (a no-op on PLAY). The keys, side
-- buttons, system element, encoder receiver (encoder_init) and encoder turn
-- (selected-slot intensity — identical to EDIT) are SHARED with the edit set via
-- deploy_layout.cjs's tplPathFor resolver.
--
-- SELF-SUFFICIENT: all data + the gdw renderer live HERE, on the LCD's own
-- budget, so a lost/failed system or key INIT can't black the screen. BUILDER
-- TEMPLATE: __NAMES__ / __COLORS__. PLAY carries NO mode-name table (no __MODES__)
-- — that buys permanent LCD-INIT budget headroom, so a fully-loaded page never
-- needs the display-shrink ladder to touch mode names.
--
-- WELCOME + PAGE FLASH: identical model to the EDIT surface — hi defaults 0
-- (live layout paints on any page load; the host arms the wordmark once per
-- fresh connect via CC __HCC__), pf = 20 DRAW frames of page flash.

lcd_set_backlight(255)
nms = __NAMES__
cls = __COLORS__
sel = 0
hsel = -1
hi = 0
vm = 1
pf = 20
pd = 0
dirty = 1
-- gdw: the full-screen 2x4 PLAY grid (2 rows of 4, 80x120 cells). Each cell is
-- its slot COLOR — ACTIVE (host feedback `acts`, per flat slot) draws at full
-- color with a contrast ring, OFF dims to 30% (d=3/10). The host-selected cell
-- (hsel, -1 = none) gets an amber ring on top. The slot NAME is drawn in the
-- cell in a contrast color when active, grey when off.
gdw = function(s)
  local pb = page_current() * 8
  for i = 0, 7 do
    local x, y, q = (i % 4) * 80, (i // 4) * 120, cls[i + 1]
    local on = ((acts or {})[pb + i + 1] or 0) > 0
    local d = on and 10 or 3
    s:draw_area_filled(x + 3, y + 3, x + 77, y + 117, {q[1] * d // 10, q[2] * d // 10, q[3] * d // 10})
    local t = (q[1] * 3 + q[2] * 6 + q[3] > 1280) and {0, 0, 0} or {255, 255, 255}
    if on or i == hsel then
      s:draw_rectangle_rounded(x + 3, y + 3, x + 77, y + 117, 4, (i == hsel) and {255, 180, 40} or t)
    end
    s:draw_text_fast(nms[i + 1] or "-", x + 7, y + 52, 16, on and t or {150, 150, 150})
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
