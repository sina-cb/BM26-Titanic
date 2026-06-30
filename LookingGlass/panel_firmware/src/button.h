#pragma once
// button.h — debounced, non-blocking push button with gesture recognition.
//
// Two layers, deliberately kept separate (best practice):
//   1. Debounce      — turns a noisy raw pin into a clean stable level + edges.
//   2. Gesture FSM    — turns clean edges + timers into high-level gestures.
//
// Emitted gestures (see config.h for the timing tunables):
//   Press            immediate debounced down-edge   (low-latency TRIGGER)
//   Release          immediate debounced up-edge
//   SingleClick      one tap, no second tap, not held (fires after the
//                    double-press window — slight, intentional latency)
//   DoubleClick      two taps inside DOUBLE_PRESS_MS
//   LongPressStart   held past LONG_PRESS_MS            (HOLD begins)
//   HoldTick         repeats every HOLD_REPEAT_MS while held (HOLD usage)
//   LongPressStop    released after a hold              (HOLD ends)
//
// Pick the layer that fits each button: use Press/Release for instant
// triggers and fire-on-hold, or SingleClick/DoubleClick/LongPress* for
// de-duplicated, gesture-aware controls.
#include <Arduino.h>
#include "config.h"

class Button;  // fwd-decl for the event-sink typedef

enum class ButtonEvent : uint8_t {
    None = 0,
    Press,
    Release,
    SingleClick,
    DoubleClick,
    LongPressStart,
    HoldTick,
    LongPressStop,
};

// Event sink: the loop passes one of these to update(); the button calls
// it 0..N times per poll as gestures are recognized. A plain function
// pointer keeps this allocation-free and ISR-friendly.
typedef void (*ButtonEventFn)(const Button &, ButtonEvent);

// Stable, greppable name for an event (e.g. "PRESS", "DOUBLE_CLICK").
const char *button_event_name(ButtonEvent ev);

class Button {
  public:
    // Wire this object to a physical pin. Configures INPUT_PULLUP.
    void begin(ButtonId id, const char *name, uint8_t gpio);

    // Poll once per loop(); pass a shared millis() timestamp and the sink.
    // Never blocks, never calls delay().
    void update(uint32_t now_ms, ButtonEventFn emit);

    ButtonId    id()      const { return id_; }
    const char *name()    const { return name_; }
    uint8_t     gpio()    const { return gpio_; }
    bool        pressed() const { return stable_pressed_; }

  private:
    enum class Phase : uint8_t { Idle, Pressed, Hold, WaitSecond };

    ButtonId    id_   = BUTTON_COUNT;   // BUTTON_COUNT == "unbound"
    const char *name_ = "";
    uint8_t     gpio_ = 0;

    // --- debounce layer ---
    bool     last_reading_pressed_ = false;  // most recent raw sample
    bool     stable_pressed_       = false;  // debounced, committed state
    uint32_t last_change_ms_       = 0;      // when the raw sample last moved

    // --- gesture FSM layer ---
    Phase    phase_              = Phase::Idle;
    uint32_t press_start_ms_     = 0;   // when the current press went down
    uint32_t last_up_ms_         = 0;   // when the last release happened
    uint32_t last_hold_tick_ms_  = 0;   // last HoldTick emission
    bool     long_fired_         = false;  // LongPressStart already sent?
    bool     pending_double_     = false;  // current press is a 2nd tap
};
