-- encoder_turn.lua — effects layout, encoder ENDLESS (element 8, event ENDLESS).
--
-- Relative-mode input (63/65 around 64) edits the SELECTED slot's local
-- value; the LCD + 5-LED bar update instantly (local predict) and the new
-- ABSOLUTE value goes to the host.
--
-- KNOB BUG FIX (root-caused in firmware): the endless event's function name
-- is "epc", so auto-MIDI p2 (= epva()) sent the RELATIVE 63/65 stream on
-- CC 40 — the host never saw an absolute value. Now we emit explicitly:
--   CC (0xB0 + page), controller __SB__ + sel, value = vals[slot] (0..127)
-- i.e. a per-slot ABSOLUTE value CC that mirrors the host->device value
-- feedback numbering — stateless for the host, no selection tracking needed.
-- (Encoder PRESS stays auto note 40 = mode cycle; that path works.)

self:endless_mode(1)
self:endless_velocity(50)
self:endless_min(0)
self:endless_max(127)
self:endless_sensitivity(50)
if cls ~= nil then
  local si = page_current() * 8 + sel + 1
  local d = math.floor(self:endless_value()) - 64
  vals[si] = math.max(0, math.min(127, math.floor((vals[si] or 0) + d)))
  if ebar ~= nil then ebar(vals[si]) end
  dirty = 1
  self:midi_send(-1, 176, __SB__ + sel, vals[si])
end
