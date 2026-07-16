-- grid_bright — 2x4 color-rectangle grid, SATURATED palette, BLACK labels.
-- Purpose: evaluate the "effect grid" look + name legibility on the panel.
--
-- This is an LCD DRAW handler (element 13, event 8) in the `self:` element form
-- (self:draw_area_filled / self:draw_text_fast / self:draw_swap — verified verbs
-- from lcd_draw.lua + hello_world.lua). It draws UNCONDITIONALLY every tick so
-- the screen HOLDS (ui_lab writes it without a flash-commit; power-cycle or
-- --restore reverts). Corners are (x1,y1,x2,y2). Screen 320x240.
-- Cells 70 wide; cols x1 = 8,86,164,242; rows y1 = 40,140.
self:draw_area_filled(0, 0, 319, 239, {8, 8, 12})
self:draw_text_fast("EFFECTS", 108, 10, 22, {255, 255, 255})
self:draw_area_filled(8, 40, 78, 126, {255, 40, 40})
self:draw_text_fast("UV", 22, 74, 20, {0, 0, 0})
self:draw_area_filled(86, 40, 156, 126, {255, 140, 0})
self:draw_text_fast("VNT", 92, 74, 20, {0, 0, 0})
self:draw_area_filled(164, 40, 234, 126, {255, 220, 0})
self:draw_text_fast("TRL", 170, 74, 20, {0, 0, 0})
self:draw_area_filled(242, 40, 312, 126, {60, 220, 60})
self:draw_text_fast("GHT", 248, 74, 20, {0, 0, 0})
self:draw_area_filled(8, 140, 78, 226, {0, 200, 200})
self:draw_text_fast("FOG", 14, 174, 20, {0, 0, 0})
self:draw_area_filled(86, 140, 156, 226, {60, 120, 255})
self:draw_text_fast("BLT", 92, 174, 20, {255, 255, 255})
self:draw_area_filled(164, 140, 234, 226, {160, 60, 255})
self:draw_text_fast("WSH", 170, 174, 20, {255, 255, 255})
self:draw_area_filled(242, 140, 312, 226, {255, 60, 200})
self:draw_text_fast("DRP", 248, 174, 20, {0, 0, 0})
self:draw_swap()
