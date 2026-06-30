#pragma once
// =============================================================
//  config.h — LookingGlass control panel (structural definitions)
//  The button -> GPIO map (BUTTON_TABLE) and the reserved-pin list live here
//  because they are hardware-fixed / code-coupled. ALL numeric & string
//  TUNABLES (firmware identity, serial, button timing, lamp, status LED, and
//  network) live in config.yaml and are generated into
//  generated/net_config.h at build time by scripts/gen_config.py.
// =============================================================
#include <Arduino.h>

// =============================================================
//  Button map  (structural — hardware-fixed; NOT in config.yaml)
//  X(<ID token>, <GPIO>)
//  - The ID token becomes BOTH the enum value (BTN_<ID>) and the name
//    string printed in events ("<ID>"). Rename in ONE place.
//  - All buttons are wired GPIO -> switch -> GND with the internal pull-up,
//    so they are ACTIVE-LOW (pressed == LOW).
//
//  NOTE: ARCADE_2 (was GPIO18) is removed — GPIO18 is the illuminated-button
//  LAMP OUTPUT (see lamp.* in config.yaml). A pin can't be both an input and
//  the lamp output; to restore ARCADE_2 move it to a free GPIO and set
//  lamp.enabled: false in config.yaml.
// =============================================================
#define BUTTON_TABLE(X)   \
    X(ARCADE_1,  15)      \
    X(ARCADE_3,  16)      \
    X(ARCADE_4,  39)      \
    X(ARCADE_5,  40)      \
    X(NO_BUTTON, 41)

// Build the ButtonId enum straight from the table. BUTTON_COUNT trails the
// list and doubles as the array size / loop bound.
enum ButtonId : uint8_t {
#define X(id, gpio) BTN_##id,
    BUTTON_TABLE(X)
#undef X
    BUTTON_COUNT
};

// All tunables (FW_*, SERIAL_*, DEBOUNCE_MS, BUTTON_LAMP_*, STATUS_LED_*,
// CFG_* network) are baked from config.yaml + the env-provided build secrets.
// BUTTON_LAMP_SOURCE expands to a BTN_* id, so this include MUST follow the
// ButtonId enum above.
#include "generated/net_config.h"

// =============================================================
//  RESERVED PINS — NEVER assign a button (or the lamp/LED) to these.
//  ESP32-S3-Pico hazards:
//    33,34,35,36,37  -> octal PSRAM            (breaks RAM if repurposed)
//    19,20           -> native USB D-/D+       (USB Serial/JTAG console)
//    43,44           -> UART0                  (secondary UART path)
//    0,3,45,46       -> strapping pins         (boot mode / flash voltage)
//    21              -> onboard WS2812          (status LED)
//    18              -> button lamp OUTPUT       (illuminated button)
//  In use by buttons: 15,16,39,40,41. Other GPIOs (4-14,17,...) are generally
//  free — check the board pinout before adding more.
// =============================================================
