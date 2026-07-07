#pragma once
// telemetry.h — shared firmware state for the web/telemetry portal.
//
// The button scanner runs on core 1 (Arduino loop) and the web portal on
// core 0. This is the hand-off between them: the writer (button core) calls
// telemetry_note(); the reader (web core) calls telemetry_snapshot(). All
// access is guarded by a portMUX spinlock, so updates are atomic across
// cores and the reader always sees a consistent copy.
#include <Arduino.h>
#include "config.h"
#include "button.h"

struct Telemetry {
    uint32_t total_events = 0;
    uint32_t press_counts[BUTTON_COUNT] = {0};  // PRESS events per button
    uint32_t state_mask = 0;                    // bit i set => button i is down
    uint8_t  last_btn = 0xFF;                    // 0xFF == none yet
    uint8_t  last_action = 0;                    // ButtonEvent of last event
    uint32_t last_event_ms = 0;
};

// Record one button event (writer side; safe to call from the button core).
void telemetry_note(uint8_t btn_index, ButtonEvent ev, uint32_t now_ms);

// Return a consistent copy of the current telemetry (reader side).
Telemetry telemetry_snapshot();
