-- lcd_draw.lua — effects layout PLAY profile, LCD DRAW (element 13, page 0).
--
-- Big-cell PERFORMANCE surface: draws the welcome (host-armed on connect) or the
-- full-screen PLAY grid (gdw). No detail line, no view-mode branch — PLAY is
-- ALWAYS the grid (unlike EDIT, which switches DRUM/EFFECT readouts).
--
-- Gates on cls (this element's own LCD INIT data) so a lost SYSTEM or KEY init
-- can't leave DRAW comparing an undefined; gdw / wdw / fdw are nil-guarded so a
-- lost init degrades to a minimal readout, never a black screen. PAGE FLASH:
-- paints once (pd), counts 20 frames with zero render cost, one final repaint
-- clears it (same cadence as the EDIT surface).

if (dirty or 0) > 0 and cls ~= nil then
  dirty = dirty - 1
  local fl = (pf or 0) > 0
  if fl then
    pf = pf - 1
    dirty = 1
  end
  if (not fl) or pd ~= 1 then
    if fl then pd = 1 else pd = 0 end
    self:draw_area_filled(0, 0, 319, 239, {0, 0, 0})
    if hi == 1 and (not fl) and wdw ~= nil then
      wdw(self)
    elseif gdw ~= nil then
      gdw(self)
    else
      -- Fallback if the LCD INIT that hosts gdw was lost mid-deploy: a minimal
      -- PLAY marker so the screen is never blank.
      self:draw_text_fast("PLAY", 88, 100, 48, {255, 255, 255})
    end
    if fl then
      if fdw ~= nil then
        fdw(self)
      else
        self:draw_text_fast("MarsinLED", 72, 88, 32, {226, 88, 34})
      end
    end
    self:draw_swap()
  end
end
