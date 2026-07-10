-- hello_world.lua — minimal VSN1 LCD draw event (DATA, not uploaded here).
--
-- This is the Lua body for the LCD element's DRAW event (event type 8 /
-- key "DRAW"). Paste it as the LCD draw action, or feed it to the future
-- write tool as the CONFIG/EXECUTE ACTIONSTRING for (element=lcd, event=DRAW).
--
-- The VSN1 screen is 320 x 240.
--
-- API VERIFIED against a live VSN1L (fw 1.5.1) by dumping its factory LCD
-- config with read_config.cjs (see dumps/). Observed signatures:
--   self:draw_area_filled(x1, y1, x2, y2, color)   -- color = {r, g, b} table
--   self:draw_text_fast(text, x, y, size, color)   -- text FIRST; size in px,
--                                                  --   glyph advance == size
--   self:draw_swap()                               -- present the back buffer
--   self:screen_width()                            -- 320 on VSN1
--   lcd_set_backlight(0..255)                      -- global, set in INIT
--
-- Centering math: at font size S a string of N chars is ~ N*S px wide.
-- "Hello World" = 11 chars; at size 24 -> 264 px -> x = (320-264)/2 = 28.
-- Vertically: y is the glyph top; center row ~ (240-24)/2 = 108.

-- Clear the whole 320x240 panel to black.
self:draw_area_filled(0, 0, 319, 239, {0, 0, 0})

-- Centered "Hello World" in white, font size 24.
self:draw_text_fast("Hello World", 28, 108, 24, {255, 255, 255})

-- Present.
self:draw_swap()
