#include "telemetry.h"

static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
static Telemetry    g_tele;

void telemetry_note(uint8_t btn_index, ButtonEvent ev, uint32_t now_ms) {
    portENTER_CRITICAL(&g_mux);
    g_tele.total_events++;
    g_tele.last_btn      = btn_index;
    g_tele.last_action   = (uint8_t)ev;
    g_tele.last_event_ms = now_ms;
    if (btn_index < BUTTON_COUNT) {
        if (ev == ButtonEvent::Press) {
            g_tele.press_counts[btn_index]++;
            g_tele.state_mask |= (1u << btn_index);
        } else if (ev == ButtonEvent::Release) {
            g_tele.state_mask &= ~(1u << btn_index);
        }
    }
    portEXIT_CRITICAL(&g_mux);
}

Telemetry telemetry_snapshot() {
    Telemetry copy;
    portENTER_CRITICAL(&g_mux);
    copy = g_tele;
    portEXIT_CRITICAL(&g_mux);
    return copy;
}
