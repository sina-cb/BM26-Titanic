-- key_bc_toggle.lua — effects layout, main-key BC for TOGGLE slots.
--
-- Replaces the factory BC on keys whose slot behavior is "toggle": sends
-- the auto note (32+k, ch = page) exactly like factory, but does NOT touch
-- its own LED — sticky ON/OFF LED state comes exclusively from the host's
-- slot-active feedback (see encoder_init.lua). The device stays stateless:
-- a press is select + note out; CaptainPad decides select-vs-toggle.
-- Trigger slots keep the factory BC verbatim (momentary tap-flash).

self:button_mode(0)
self:button_min(0)
self:button_max(127)
self:midi_send(-1, -1, -1, -1)
