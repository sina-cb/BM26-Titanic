#include "button.h"

const char *button_event_name(ButtonEvent ev) {
    switch (ev) {
        case ButtonEvent::Press:          return "PRESS";
        case ButtonEvent::Release:        return "RELEASE";
        case ButtonEvent::SingleClick:    return "SINGLE_CLICK";
        case ButtonEvent::DoubleClick:    return "DOUBLE_CLICK";
        case ButtonEvent::LongPressStart: return "LONG_PRESS_START";
        case ButtonEvent::HoldTick:       return "HOLD";
        case ButtonEvent::LongPressStop:  return "LONG_PRESS_STOP";
        default:                          return "NONE";
    }
}

void Button::begin(ButtonId id, const char *name, uint8_t gpio) {
    id_   = id;
    name_ = name;
    gpio_ = gpio;

    // Active-low: the switch pulls the pin to GND, the internal pull-up
    // holds it HIGH when released. We do NOT guard a bad pin here — a
    // missing/invalid GPIO must fail loudly at flash/boot, not silently.
    pinMode(gpio_, INPUT_PULLUP);

    const bool raw = (digitalRead(gpio_) == LOW);  // LOW == pressed
    last_reading_pressed_ = raw;
    stable_pressed_       = raw;
    last_change_ms_       = millis();
}

void Button::update(uint32_t now, ButtonEventFn emit) {
    // ---------------------------------------------------------------
    // Layer 1 — debounce: derive a clean stable level and its edges.
    // ---------------------------------------------------------------
    const bool raw = (digitalRead(gpio_) == LOW);  // LOW == pressed

    if (raw != last_reading_pressed_) {
        last_reading_pressed_ = raw;
        last_change_ms_       = now;   // any movement restarts the window
    }

    bool down_edge = false;
    bool up_edge   = false;
    if ((now - last_change_ms_) >= DEBOUNCE_MS && raw != stable_pressed_) {
        stable_pressed_ = raw;         // commit only after it held steady
        down_edge =  stable_pressed_;
        up_edge   = !stable_pressed_;
    }

    // ---------------------------------------------------------------
    // Layer 2 — gesture FSM: edges + timers -> high-level gestures.
    // ---------------------------------------------------------------
    if (down_edge) {
        emit(*this, ButtonEvent::Press);          // instant, every press
        press_start_ms_ = now;
        long_fired_     = false;
        // A press while we were waiting for a second tap == double-press.
        pending_double_ = (phase_ == Phase::WaitSecond);
        phase_          = Phase::Pressed;
    }

    if (up_edge) {
        emit(*this, ButtonEvent::Release);         // instant, every release
        if (phase_ == Phase::Hold) {
            emit(*this, ButtonEvent::LongPressStop);
            phase_          = Phase::Idle;
            pending_double_ = false;
        } else if (phase_ == Phase::Pressed) {
            if (pending_double_) {
                emit(*this, ButtonEvent::DoubleClick);
                phase_          = Phase::Idle;
                pending_double_ = false;
            } else {
                // First short tap — wait to see if a second one arrives.
                phase_       = Phase::WaitSecond;
                last_up_ms_  = now;
            }
        } else {
            phase_ = Phase::Idle;                  // defensive reset
        }
    }

    // Time-driven transitions (run every tick; cheap and rollover-safe).
    switch (phase_) {
        case Phase::Pressed:
            if (!long_fired_ && (now - press_start_ms_) >= LONG_PRESS_MS) {
                long_fired_        = true;
                phase_             = Phase::Hold;
                last_hold_tick_ms_ = now;
                emit(*this, ButtonEvent::LongPressStart);
            }
            break;

        case Phase::Hold:
            if ((now - last_hold_tick_ms_) >= HOLD_REPEAT_MS) {
                last_hold_tick_ms_ = now;
                emit(*this, ButtonEvent::HoldTick);
            }
            break;

        case Phase::WaitSecond:
            if ((now - last_up_ms_) >= DOUBLE_PRESS_MS) {
                emit(*this, ButtonEvent::SingleClick);
                phase_ = Phase::Idle;
            }
            break;

        default:
            break;
    }
}
