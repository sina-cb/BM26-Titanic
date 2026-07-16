-- lcd_init.lua — button_context demo, LCD element INIT (element 13, event INIT).
--
-- Sets up the shared Lua globals for the per-key context model:
--   sel   : index (0..7) of the last-pressed key — the "selected slot"
--   vals  : 8 independent stored values (0..127); preserved across page trips
--   cols  : 8 unique {r,g,b} colors (must match key_init colors)
--   dirty : GLOBAL redraw flag (v2 fix: was self.f — a global lets ANY
--           element action force a repaint, so the encoder action can poke
--           it directly instead of relying on event-forwarding semantics)
-- and installs the eventrx callback: any element event pokes dirty; a main-
-- key press (event type 3, element 0..7) also moves the selection AND
-- updates the encoder's LED ring to the newly selected key's color + value
-- (v2 fix, via the firmware's global `ele` element array; ring layer is 2
-- for endless elements, per grid-fw simplemidi.lua's l = {ep = 2} table).

lcd_set_backlight(255)
sel = sel or 0
vals = vals or {0, 0, 0, 0, 0, 0, 0, 0}
cols = {{255, 40, 40}, {255, 140, 0}, {255, 220, 0}, {60, 220, 60}, {0, 200, 200}, {60, 120, 255}, {160, 60, 255}, {255, 60, 200}}
dirty = 1
self.eventrx_cb = function(self, hdr, e, v, n)
  if e[3] == 3 and e[2] <= 7 then
    sel = e[2]
    local q = cols[sel + 1]
    ele[8]:led_color(-1, {{q[1], q[2], q[3], 1}})
    ele[8]:led_value(2, vals[sel + 1] * 2)
  end
  dirty = 1
end
