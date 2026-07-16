-- system_init.lua — effects layout, SYSTEM element INIT (element 255, per page).
--
-- OPTIONAL decorations + LED bar on the system element's own budget. The
-- LCD is fully functional without this string (all callers nil-guard) —
-- lesson from the black-screen incident where this element's write was
-- silently lost during a still-running page load. Factory MAP/TIMER
-- events untouched.
--
-- ebar(v): 5-LED encoder progress bar (exactly 5 LEDs on the VSN1 endless,
--   grid-fw grid_esp32s3.c): 5 x 20% bands, below full / above off /
--   in-band linear ramp, selected slot's color, layer 2. Flip i -> 4 - i
--   if the physical order is inverted.
-- wdw(s): the MarsinLED boot welcome artwork.
-- fdw(s): the deploy TOAST — the MarsinLED logo (no page number). Paging is
--   retired (always page 0), so the old "P<n>" flash carried no signal; this
--   now flashes the brand wordmark for pf frames when a (re)deploy lands.
--   Reuses wdw's known-good wordmark coords minus the "welcome aboard" line,
--   over a full-screen clear so it reads as a clean overlay on any view.

ebar = function(v)
  local q = cls and cls[sel + 1] or {255, 255, 255}
  for i = 0, 4 do
    local a = led_address_get(8, i)
    local b = (v * 5 - i * 127) * 255 // 127
    if b < 0 then b = 0 elseif b > 255 then b = 255 end
    led_color(a, 2, q[1], q[2], q[3])
    led_value(a, 2, b)
  end
end
wdw = function(s)
  s:draw_rectangle_rounded_filled(130, 30, 190, 90, 30, {226, 88, 34})
  s:draw_text_fast("Marsin", 16, 116, 32, {255, 255, 255})
  s:draw_text_fast("LED", 208, 116, 32, {226, 88, 34})
  s:draw_area_filled(16, 158, 303, 163, {226, 88, 34})
  s:draw_text_fast("welcome aboard", 48, 184, 16, {170, 170, 170})
end
fdw = function(s)
  s:draw_area_filled(0, 0, 319, 199, {0, 0, 0})
  s:draw_rectangle_rounded_filled(130, 30, 190, 90, 30, {226, 88, 34})
  s:draw_text_fast("Marsin", 16, 116, 32, {255, 255, 255})
  s:draw_text_fast("LED", 208, 116, 32, {226, 88, 34})
  s:draw_area_filled(16, 158, 303, 163, {226, 88, 34})
end
