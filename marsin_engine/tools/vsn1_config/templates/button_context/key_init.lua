-- key_init.lua — button_context demo, main-key INIT (elements 0..7, event INIT).
--
-- BUILDER TEMPLATE: __R__/__G__/__B__ are substituted per key by
-- build_button_context.cjs with that key's unique color (same table as
-- lcd_init.lua cols). Parses as valid Lua even unsubstituted (identifiers).
--
-- Sets the key's own LED to its unique color (best-effort nicety — the LED
-- color/value argument format is mimicked from the factory BC action and is
-- untested on hardware; the LCD behavior is the actual requirement). The
-- factory BC action is left untouched, so a press still flashes the LED (in
-- this color) and still sends MIDI.

self:led_color(-1, {{__R__, __G__, __B__, 1}})
