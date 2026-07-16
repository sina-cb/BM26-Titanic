-- effects_status.lua — DRAFT. NOT UPLOADED ANYWHERE. NOT WIRED IN.
-- =============================================================================
-- DRAFT / DESIGN SKETCH ONLY. This is a data template for a future wave. It is
-- not sent to any device by this tool. The draw API below IS verified (dumped
-- from a live VSN1L fw 1.5.1 — see hello_world.lua header), but the exact
-- inbound value routing still needs on-device validation. Do not upload as-is.
-- =============================================================================
--
-- Intent: show the currently selected effect name and an intensity bar on the
-- VSN1's 320x240 LCD, driven by values arriving from the control surface /
-- MIDI side.
--
-- DATA PATH (observed in the factory config, needs validation for our use):
-- The VSN1's LCD element has only INIT (0) and DRAW (8) events — no per-element
-- "midi rx". The factory INIT installs an inbound callback on the LCD element:
--
--   self.eventrx_cb = function(self, hdr, e, v, n)
--     -- hdr: header, e: source element info table, v: value array,
--     -- n: name string ('' if unnamed)
--     self.v = v          -- stash latest values for DRAW
--     self.f = 1          -- mark dirty -> DRAW renders next frame
--   end
--
-- and DRAW renders from self.v, gated on the self.f dirty flag. This template
-- follows that same INIT/DRAW split. The INIT part (install callback, palette,
-- backlight) goes into the LCD INIT event; the part below goes into DRAW.
--
-- Effect names should mirror marsin_engine's effect ids. Kept inline here as a
-- draft; the real list should be generated from the engine's effect registry.
--
-- ---- assumed INIT-side state (LCD INIT event, sketched, not final) ----------
--   lcd_set_backlight(255)
--   self.f = 1
--   self.effect_id = 0                 -- updated by eventrx_cb from v
--   self.intensity = 0                 -- 0..127 (MIDI CC range)
--   self.eventrx_cb = function(self, hdr, e, v, n)
--     self.effect_id, self.intensity, self.f = v[1], v[2], 1
--   end
--
-- ---- DRAW event body below --------------------------------------------------

if self.f > 0 then
  self.f = self.f - 1

  local effect_id = self.effect_id or 0
  local intensity = self.intensity or 0

  -- Draft effect name table (mirror marsin_engine effect ids).
  local EFFECTS = {
    [0] = "Freeze Frame",
    [1] = "Palette Crush",
    [2] = "Ocean Breath",
    [3] = "Frost Sparkle",
  }
  local name = EFFECTS[effect_id] or "?"

  -- Clear panel.
  self:draw_area_filled(0, 0, 319, 239, {0, 0, 0})

  -- Effect name near the top, left margin 16, font size 24.
  self:draw_text_fast(name, 16, 40, 24, {255, 255, 255})

  -- Intensity bar: track 16..303 px wide at y = 140..170; map 0..127 -> 0..288.
  local bar_w = (intensity * 288) // 127

  -- Bar track (dim grey) then filled portion (bright cyan).
  self:draw_area_filled(16, 140, 303, 170, {40, 40, 40})
  if bar_w > 0 then
    self:draw_area_filled(16, 140, 16 + bar_w, 170, {0, 200, 220})
  end

  -- Numeric readout under the bar, font size 16.
  self:draw_text_fast("intensity " .. tostring(intensity), 16, 190, 16, {180, 180, 180})

  self:draw_swap()
end
