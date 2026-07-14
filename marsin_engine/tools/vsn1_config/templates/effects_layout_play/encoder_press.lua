-- encoder_press.lua — effects layout PLAY profile, encoder BC / press (element 8).
--
-- PLAY: the encoder press is a NO-OP (operator-approved default). On the EDIT
-- surface the press cycles the selected slot's primary mode (auto note 40 → the
-- engine cycles + echoes); PLAY's performance surface does not remap modes from
-- the encoder, so the press emits NOTHING. The button is still configured
-- (mode/min/max) so its input state is defined; it simply never calls
-- midi_send, so no MIDI leaves the device on press or release.
--
-- (The profile SWITCH itself is sb_2, handled host-side by CaptainPad — this
-- encoder press does not touch it.)

self:button_mode(0)
self:button_min(0)
self:button_max(127)
