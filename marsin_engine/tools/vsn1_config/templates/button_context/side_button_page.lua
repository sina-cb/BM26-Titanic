-- side_button_page.lua — button_context demo, side-button BC
-- (elements 9..12, event BC — deployed to ALL FOUR PAGES).
--
-- sb0 (element 9)  -> page 0        sb1 (element 10) -> page 1
-- sb2 (element 11) -> page 2        sb3 (element 12) -> page 3
--
-- element_index() - 9 maps the side button to its page number, so ONE
-- template serves all four buttons with no substitution. page_load() is the
-- same call the factory system MAP event uses (page_load(page_next())).
-- The button_value() > 0 guard fires on press only (BC also fires on
-- release with value 0 — without the guard every press would page-switch
-- twice). Deployed to every page so you can always get back; the module's
-- physical utility button (system MAP: cycle pages) remains as the native
-- fallback path.

self:button_mode(0)
self:button_min(0)
self:button_max(127)
if self:button_value() > 0 then
  page_load(self:element_index() - 9)
end
