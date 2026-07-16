-- list_view — vertical list: a color swatch + full effect name per row.
-- An alternative to the grid: prioritizes readable NAMES over color area.
-- LCD DRAW handler, self: form, unconditional draw.
-- 8 rows, 28 px pitch from y=8; swatch x 8..40, name at x=48 size 20.
self:draw_area_filled(0, 0, 319, 239, {8, 8, 12})
self:draw_area_filled(8, 8, 40, 30, {255, 40, 40})
self:draw_text_fast("UV Blast", 48, 10, 20, {235, 235, 235})
self:draw_area_filled(8, 36, 40, 58, {255, 140, 0})
self:draw_text_fast("Vintage", 48, 38, 20, {235, 235, 235})
self:draw_area_filled(8, 64, 40, 86, {255, 220, 0})
self:draw_text_fast("Trails", 48, 66, 20, {235, 235, 235})
self:draw_area_filled(8, 92, 40, 114, {60, 220, 60})
self:draw_text_fast("Ghost", 48, 94, 20, {235, 235, 235})
self:draw_area_filled(8, 120, 40, 142, {0, 200, 200})
self:draw_text_fast("Fogger", 48, 122, 20, {235, 235, 235})
self:draw_area_filled(8, 148, 40, 170, {60, 120, 255})
self:draw_text_fast("Blast", 48, 150, 20, {235, 235, 235})
self:draw_area_filled(8, 176, 40, 198, {160, 60, 255})
self:draw_text_fast("Wash", 48, 178, 20, {235, 235, 235})
self:draw_area_filled(8, 204, 40, 226, {255, 60, 200})
self:draw_text_fast("Drop", 48, 206, 20, {235, 235, 235})
self:draw_swap()
