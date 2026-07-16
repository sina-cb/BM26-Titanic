-- lcd_draw.lua — button_context demo, LCD element DRAW (element 13, event DRAW).
--
-- Repaints when the GLOBAL dirty flag is set (v2 fix: was self.f — the
-- encoder action now pokes `dirty` directly, so the bar always tracks the
-- encoder even if event forwarding to the LCD is lossy for endless events).
-- Draws: big swatch in the selected key's color, "KEY n", the stored value
-- as text and as a bar, and (v2 fix) the current page index "P<n>" in the
-- top-right corner via page_current().
-- The `cols ~= nil` guard covers a draw tick before lcd_init has run.

if dirty ~= nil and dirty > 0 and cols ~= nil then
  dirty = dirty - 1
  local c = cols[sel + 1]
  local v = vals[sel + 1]
  self:draw_area_filled(0, 0, 319, 239, {0, 0, 0})
  self:draw_area_filled(10, 10, 309, 130, c)
  self:draw_text_fast("KEY " .. (sel + 1), 16, 150, 24, c)
  self:draw_text_fast(tostring(v), 240, 150, 24, {255, 255, 255})
  self:draw_text_fast("P" .. page_current(), 286, 6, 16, {140, 140, 140})
  local w = (v * 288) // 127
  self:draw_area_filled(16, 196, 303, 220, {40, 40, 40})
  if w > 0 then
    self:draw_area_filled(16, 196, 16 + w, 220, c)
  end
  self:draw_swap()
end
