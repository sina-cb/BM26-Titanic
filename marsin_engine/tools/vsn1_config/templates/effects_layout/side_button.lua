-- side_button.lua — effects layout, SMALL-BUTTON BC (elements 9..12, all pages).
--
-- Terminology (docs/42): these are the four SMALL PANEL BUTTONS sb_0..sb_3
-- (device elements 9..12), NOT the single physical side button — THAT one is
-- the firmware-native page switcher and we never touch it. The filename is a
-- historical misnomer.
--
-- SMALL BUTTONS NEVER CHANGE PAGES (2026-07-09). The local page_load(N) is
-- GONE: paging is exclusively the physical side button's firmware-native job.
-- Each small button now only emits its note (sbNoteBase + N = 41 + N, ch =
-- current page, grid-fw auto-MIDI) and the HOST decides everything:
--   sb_0 (note 41) → VIEW MODE: single click = DRUM view, double click =
--                    EFFECT view (host-side click/double-click detection from
--                    note timestamps; the device does NO timing across VM
--                    restarts). The host echoes the resulting mode back as a
--                    feedback CC so it survives the page-load VM wipe.
--   sb_1 (note 42) → no-op for now (host ignores; TODO: assign an action).
--   sb_2 (note 43) → POST /global-effects/reset-all  (host-mapped).
--   sb_3 (note 44) → POST /global-effects/disable-all (host-mapped).
-- The device stays stateless: a press is just a note out.
--
-- midi_send(-1,-1,-1,-1) emits the element's configured auto-MIDI (note
-- sbNoteBase+N, velocity = button_value) on BOTH edges — press sends vel 127,
-- release sends vel 0. The host acts on the press (vel > 0) and ignores the
-- release, so no on-device edge guard is needed (matches the factory contract
-- the profile's note handlers already expect).

self:button_mode(0)
self:button_min(0)
self:button_max(127)
self:midi_send(-1, -1, -1, -1)
