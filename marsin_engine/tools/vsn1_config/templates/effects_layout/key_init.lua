-- key_init.lua — effects layout, main-key INIT (elements 0..7, event INIT).
--
-- BUILDER TEMPLATE: __R__/__G__/__B__ substituted per key from the layout slot's
-- color (empty slots get a dim grey).
--
-- LED-ARG FIX (item 2): a button's LED needs its COLOR set on an EXPLICIT layer.
-- self:led_color(-1, ...) resolves the layer via the event name, but inside an
-- INIT (event "ini") the auto-layer is nil -> the call no-ops and the LED had no
-- color, so the receiver's later brightness write lit a BLACK LED. Set the color
-- on layer 1 (the button LED layer, per grid-fw simplecolor.lua
-- event_handler_to_layer["bc"] = 1) explicitly. Brightness starts at 0 (off) — the
-- sticky ON/OFF level then comes from the host's slot-active feedback
-- (encoder_init.lua receiver). The factory BC's own momentary flash still uses
-- this same colored layer.
--
-- DTL — the LCD DETAIL renderer lives HERE (2026-07-10), NOT on the LCD element.
-- Budget: the LCD INIT is at its ~872/909 ceiling (arrays + the grid renderer gdw
-- + eventrx), and gdw + dtl together exceed 909 on any single element — so the two
-- LCD renderers MUST live on different elements. The 8 key INITs each have ~850
-- chars free and ALL run on every page load before the first DRAW, so `dtl` is a
-- global that is always defined by paint time (re-assigned harmlessly by keys 1-7).
-- It reads the shared globals (sel/vals/mods/acts/cls/nms/mnm) the host feedback
-- fills. DRAW nil-guards it (a lost key INIT degrades to a minimal readout, never a
-- black screen).
--
-- dtl(s): the pressed/selected slot's detail readout, in ONE draw sequence whose
-- SIZES + y baselines switch on the view mode (d = DRUM). A per-mode coordinate
-- table L holds every value that differs: {nameX,nameY,nameSize, valX,valY,valSize,
-- lineY,lineSize, onX, barY}. DRUM (d): a full-screen readout — a LARGE name up
-- top, a VERY LARGE value number, a bold mode line, ON + P<n>, a value bar RAISED
-- to leave a bottom strip, and a row of the four SMALL-BUTTON LABELS (sb_0 MODE,
-- sb_1 unused, sb_2 RESET, sb_3 OFF) centered above their physical buttons (4
-- columns of 80 px, centers 40/120/200/280) so the operator knows each button's
-- job. EFFECT (not d): a COMPACT detail line UNDER the grid (the grid's per-cell
-- abbreviations already name the slots); no labels, bar at the usual spot.

self:led_color(1, {{__R__, __G__, __B__, 1}})
self:led_value(1, 0)
-- knd: the 32-entry toggle(1)/trigger(0) array the encoder receiver reads for its
-- sticky-LED gate. It rides the KEY INIT (not the LCD INIT, which is near its 909
-- ceiling with the arrays + grid, nor the encoder INIT, which is at its ceiling
-- with the receiver). Defined as a global here (re-assigned harmlessly by keys
-- 1-7); all INITs run on every page load before any MIDI, so it is always ready.
knd = __KINDS__
dtl = function(s)
  local d = vm ~= 1
  local si = page_current() * 8 + sel + 1
  local v = (vals or {})[si] or 0
  local c = cls[sel + 1]
  local L = d and {14, 22, 32, 14, 74, 64, 150, 24, 214, 184} or {16, 118, 24, 250, 118, 24, 156, 16, 200, 200}
  s:draw_text_fast(nms[sel + 1], L[1], L[2], L[3], (sel == hsel) and {255, 180, 40} or c)
  s:draw_text_fast(tostring(v), L[4], L[5], L[6], {255, 255, 255})
  local mn = (mnm[sel + 1] or {})[((mods or {})[si] or 0) + 1] or "-"
  s:draw_text_fast(mn, L[1], L[7], L[8], {200, 200, 200})
  if ((acts or {})[si] or 0) > 0 then s:draw_text_fast("ON", L[9], L[7], L[8], {60, 255, 60}) end
  s:draw_text_fast("P" .. page_current(), 286, L[7], 16, {140, 140, 140})
  local w = (v * 288) // 127
  s:draw_area_filled(16, L[10], 303, L[10] + 18, {40, 40, 40})
  if w > 0 then s:draw_area_filled(16, L[10], 16 + w, L[10] + 18, c) end
  -- Readout view only: the four small-button labels along the bottom strip,
  -- each centered over its physical button column (~8 px/char at size 14).
  -- Sina's sb map (2026-07-10): sb_0 MODE / sb_1 VIEW / sb_2 empty / sb_3 LOGO.
  if d then
    local bl = {"MODE", "VIEW", "-", "LOGO"}
    for i = 0, 3 do
      s:draw_text_fast(bl[i + 1], i * 80 + 40 - #bl[i + 1] * 4, 220, 14, {150, 150, 150})
    end
  end
end
