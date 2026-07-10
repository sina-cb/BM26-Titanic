-- grid_pastel — same 2x4 grid, DESATURATED palette, DARK labels.
-- Compare against grid_bright for on-panel legibility (bright vs muted cells).
-- LCD DRAW handler, self: form, unconditional draw. Cells 70 wide;
-- cols x1 = 8,86,164,242; rows y1 = 40,140.
self:draw_area_filled(0, 0, 319, 239, {18, 18, 22})
self:draw_text_fast("EFFECTS", 108, 10, 22, {200, 200, 210})
self:draw_area_filled(8, 40, 78, 126, {210, 120, 120})
self:draw_text_fast("UV", 22, 74, 20, {30, 10, 10})
self:draw_area_filled(86, 40, 156, 126, {210, 170, 110})
self:draw_text_fast("VNT", 92, 74, 20, {30, 20, 10})
self:draw_area_filled(164, 40, 234, 126, {200, 200, 120})
self:draw_text_fast("TRL", 170, 74, 20, {30, 30, 10})
self:draw_area_filled(242, 40, 312, 126, {130, 200, 130})
self:draw_text_fast("GHT", 248, 74, 20, {10, 30, 10})
self:draw_area_filled(8, 140, 78, 226, {120, 190, 190})
self:draw_text_fast("FOG", 14, 174, 20, {10, 30, 30})
self:draw_area_filled(86, 140, 156, 226, {130, 150, 210})
self:draw_text_fast("BLT", 92, 174, 20, {10, 15, 35})
self:draw_area_filled(164, 140, 234, 226, {170, 130, 210})
self:draw_text_fast("WSH", 170, 174, 20, {25, 10, 35})
self:draw_area_filled(242, 140, 312, 226, {210, 130, 190})
self:draw_text_fast("DRP", 248, 174, 20, {35, 10, 30})
self:draw_swap()
