-- endless_edit.lua — button_context demo, encoder ENDLESS (element 8, event ENDLESS).
--
-- Relative mode: endless_value() reports 64±delta (63 = CCW, 65 = CW, larger
-- with velocity). The delta edits the SELECTED key's stored value, clamped
-- 0..127 — pickup-free across selection changes.
--
-- v2 fixes:
--   * math.floor() on the delta and the stored value — endless_value() type
--     is not documented; a float creeping into vals would render as "5.0"
--     and can make integer-expecting draw/led calls misbehave (the suspected
--     LCD-bar bug). Values are now guaranteed integers.
--   * The encoder's own LED ring now tracks the selected key's value
--     (led_value layer 2 = endless ring per grid-fw, brightness = value*2)
--     in the selected key's color.
--   * Pokes the GLOBAL dirty flag so the LCD repaints even if endless events
--     don't reach the LCD's eventrx (the suspected reason the bar lagged).
--
-- Settings re-asserted in the action, factory pattern. The midi tail keeps
-- MIDI out working (auto: CC 40, channel = current page).

self:endless_mode(1)
self:endless_velocity(50)
self:endless_min(0)
self:endless_max(127)
self:endless_sensitivity(50)
local d = math.floor(self:endless_value()) - 64
if vals ~= nil then
  vals[sel + 1] = math.max(0, math.min(127, math.floor(vals[sel + 1] + d)))
  local q = cols[sel + 1]
  self:led_color(-1, {{q[1], q[2], q[3], 1}})
  self:led_value(2, vals[sel + 1] * 2)
  dirty = 1
end
self:midi_send(-1, -1, -1, -1)
