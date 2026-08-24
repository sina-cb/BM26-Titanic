-- layout_rx.lua — runtime page-layout receiver (element 9 INIT).
--
-- CaptainPad sends names on CC channel 13, colors/behavior/commit on channel
-- 14, and mode labels on channel 15. All fields update shared Lua globals; only
-- the commit CC repaints, so the LCD never exposes a half-received layout.

self.midirx_cb = function(self, h, e)
  if h[1] ~= 13 or e[2] ~= 176 then return end
  local c, p, v = e[1], e[3], e[4]
  if c == 13 and p < 80 then
    local k, j = p // 10 + 1, p % 10
    local s = nms[k] or "          "
    nms[k] = string.sub(s, 1, j) .. string.char(v) .. string.sub(s, j + 2)
  elseif c == 14 then
    if p < 24 then
      local k, j = p // 3 + 1, p % 3 + 1
      cls[k][j] = v * 2
    elseif p < 32 then
      knd[page_current() * 8 + p - 23] = v
    elseif p == 127 then
      local b = page_current() * 8
      for i = 0, 7 do
        local q = cls[i + 1]
        ele[i]:led_color(1, {{q[1], q[2], q[3], 1}})
        if knd[b + i + 1] == 1 then
          ele[i]:led_value(1, ((acts or {})[b + i + 1] or 0) * 255)
        end
      end
      if ebar ~= nil then ebar((vals or {})[b + sel + 1] or 0) end
      dirty = 1
      -- ACK the exact commit revision only after globals/LEDs are applied.
      self:midi_send(-1, 176, 44, v)
    end
  elseif c == 15 then
    if p >= 120 then
      local k = p - 119
      mnm[k] = {}
      for i = 1, v do mnm[k][i] = "   " end
    else
      local k, r = p // 15 + 1, p % 15
      local m, j = r // 3 + 1, r % 3
      local s = mnm[k][m] or "   "
      mnm[k][m] = string.sub(s, 1, j) .. string.char(v) .. string.sub(s, j + 2)
    end
  end
end
