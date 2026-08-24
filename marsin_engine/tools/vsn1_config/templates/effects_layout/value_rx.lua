-- value_rx.lua — host-value receiver with encoder echo reconciliation.
--
-- Grid predicts the selected slot locally while the endless encoder turns.
-- Engine WebSocket feedback can lag behind that prediction; accepting an old
-- value here pulled the accumulator backward (captured physically as 80→64 and
-- 93→81). Ignore a mismatching echo while a local write is pending and release
-- the guard as soon as the host confirms the same value (±1 MIDI step).

self.midirx_cb = function(self, h, e)
  if h[1] ~= 13 or e[1] ~= __FCH__ or e[2] ~= 176 or e[3] < __SB__ or e[3] >= __SB__ + 8 then return end
  local z = page_current() * 8 + e[3] - __SB__ + 1
  if lck == z and math.abs(e[4] - (lcv or -99)) > 1 then return end
  if lck == z then lck = nil end
  vals[z] = e[4]
  if e[3] - __SB__ == sel and ebar ~= nil then ebar(e[4]) end
  hi = 0
  dirty = 1
end
