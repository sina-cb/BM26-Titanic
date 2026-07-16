-- encoder_press.lua — effects layout, encoder BC / press (element 8, event BC).
--
-- Encoder press = MODE CYCLE (dossier decision; replaces press=reset-value —
-- intensity reset moves to the UI). The device does NOT cycle the mode
-- locally: it sends the press to the engine (auto MIDI: note 40, channel =
-- current page, velocity 127 press / 0 release) and the engine cycles
-- `primaryMode`, echoing the new index back on the mode-feedback CC. Track C
-- triggers on note-on with velocity > 0 only.

self:button_mode(0)
self:button_min(0)
self:button_max(127)
self:midi_send(-1, -1, -1, -1)
if self:button_value() > 0 then
  dirty = 1
end
