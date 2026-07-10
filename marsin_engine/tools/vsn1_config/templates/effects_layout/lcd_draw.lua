-- lcd_draw.lua — effects layout, LCD DRAW (element 13, every page).
--
-- Gates on this element's own data (cls, from the LCD INIT) so a lost SYSTEM or
-- KEY init can't leave the DRAW comparing an undefined; the heavier renderers are
-- nil-guarded at their call sites with graceful fallbacks (a lost init degrades,
-- never blacks the screen — the lesson from the shipped black-screen incident):
--   gdw (grid + per-cell abbreviations)  — LCD INIT.
--   dtl (the detail readout: DRUM full-screen or EFFECT compact line + drum
--        small-button labels + value bar) — a KEY INIT (gdw + dtl exceed 909 on
--        one element, so the two LCD renderers live apart; the key INITs have room
--        and all run before the first paint).
--   wdw (welcome art) / fdw (page-flash box) — SYSTEM INIT.
--
-- Base = welcome (host-armed on connect only — the device's own hello drives it,
-- so it never flashes on a page swap) or the live screen. TWO VIEW MODES (vm,
-- host-echoed):
--   DRUM  (vm == 0): NO grid — dtl gives the pressed effect a FULL-SCREEN readout
--                    (big name, big value, mode, ON, P<n>, a RAISED value bar) with
--                    the four small-button labels along the bottom strip. A key
--                    press triggers now (host routes every drum key to fire).
--   EFFECT(vm == 1): the 2x4 abbreviation grid (gdw) + dtl's compact detail line.
-- PAGE FLASH: paints once (pd), counts 20 frames with zero render cost, one final
-- repaint clears it.

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
    else
      -- EFFECT view draws the abbreviation grid first; DRUM uses the freed space.
      if vm == 1 and gdw ~= nil then gdw(self) end
      if dtl ~= nil then
        dtl(self)
      else
        -- Fallback if the KEY INIT that hosts dtl was lost mid-deploy: a minimal
        -- readout so the screen is never blank (name + value from the globals).
        self:draw_text_fast(nms[sel + 1] or "-", 16, 100, 24, {255, 255, 255})
        self:draw_text_fast(tostring((vals or {})[page_current() * 8 + sel + 1] or 0), 250, 100, 24, {255, 255, 255})
      end
    end
    if fl then
      if fdw ~= nil then
        fdw(self)
      else
        self:draw_text_fast("P" .. page_current(), 96, 88, 64, {255, 255, 255})
      end
    end
    self:draw_swap()
  end
end
