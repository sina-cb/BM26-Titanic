-- focus_view — the DRUM-view mockup: ONE effect, big. Name + value + mode +
-- value bar + ON badge. No grid. This is what the LCD would show after a key
-- press in DRUM mode. Tune sizes/positions here, then port to lcd_draw.
-- LCD DRAW handler, self: form, unconditional draw.
-- value 96/127 -> bar width 96*288//127 = 217 px from x=16.
self:draw_area_filled(0, 0, 319, 239, {8, 8, 12})
self:draw_text_fast("DRUM", 16, 12, 16, {140, 140, 140})
self:draw_text_fast("UV Blast", 16, 60, 40, {255, 40, 40})
self:draw_text_fast("96", 250, 60, 40, {255, 255, 255})
self:draw_text_fast("Pulse", 16, 120, 24, {200, 200, 200})
self:draw_text_fast("ON", 250, 124, 20, {60, 255, 60})
self:draw_area_filled(16, 175, 303, 200, {40, 40, 40})
self:draw_area_filled(16, 175, 233, 200, {255, 40, 40})
self:draw_swap()
