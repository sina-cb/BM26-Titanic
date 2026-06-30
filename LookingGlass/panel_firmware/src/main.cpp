// =============================================================
//  main.cpp — LookingGlass control-panel firmware
//
//  Reads six momentary arcade buttons, debounces them, and recognizes
//  gestures: Press / Release (instant), SingleClick, DoubleClick, and a
//  full hold lifecycle (LongPressStart -> Hold ticks -> LongPressStop).
//  Today every gesture just prints a structured line to Serial; the
//  action hooks below are where real behavior gets plugged in later.
//
//  Event line format (one per event, greppable):
//      EVT btn=ARCADE_4 action=PRESS t=12345
// =============================================================
#include <Arduino.h>
#include "config.h"
#include "button.h"
#include "telemetry.h"
#include "net_portal.h"
#include "log_bus.h"

#if STATUS_LED_ENABLED
#include <Adafruit_NeoPixel.h>
static Adafruit_NeoPixel g_status_led(STATUS_LED_COUNT, STATUS_LED_PIN,
                                      NEO_GRB + NEO_KHZ800);
static uint32_t g_flash_until_ms = 0;
static void status_led_flash() { g_flash_until_ms = millis() + STATUS_LED_FLASH_MS; }
#endif

static Button g_buttons[BUTTON_COUNT];

#if BUTTON_LAMP_ENABLED
// Illuminated-button lamp on BUTTON_LAMP_PIN (GPIO18), driven by LEDC PWM:
// a DIM glow at rest, FULL brightness while BUTTON_LAMP_SOURCE is held.
// Current is limited to ~tens of mA off a GPIO — fine for a low-current LED;
// use a transistor/MOSFET for a higher-current lamp. (See config.h.)
static bool           g_lamp_full = false;
static const uint16_t LAMP_MAX    = (1u << BUTTON_LAMP_PWM_BITS) - 1;
#if ESP_ARDUINO_VERSION_MAJOR < 3
static const uint8_t  LAMP_LEDC_CH = 2;   // LEDC channel (Arduino-ESP32 2.x API)
#endif

static void lamp_write_duty(uint16_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(BUTTON_LAMP_PIN, duty);     // 3.x writes by pin
#else
    ledcWrite(LAMP_LEDC_CH, duty);        // 2.x writes by channel
#endif
}

// Set the lamp to its full or dim level, honoring active-high/low wiring.
static void lamp_apply(bool full) {
    g_lamp_full = full;
    const uint16_t level = full ? BUTTON_LAMP_FULL : BUTTON_LAMP_DIM;   // 0..LAMP_MAX
    lamp_write_duty(BUTTON_LAMP_ACTIVE_HIGH ? level : (uint16_t)(LAMP_MAX - level));
}

static void lamp_begin() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(BUTTON_LAMP_PIN, BUTTON_LAMP_PWM_FREQ, BUTTON_LAMP_PWM_BITS);
#else
    ledcSetup(LAMP_LEDC_CH, BUTTON_LAMP_PWM_FREQ, BUTTON_LAMP_PWM_BITS);
    ledcAttachPin(BUTTON_LAMP_PIN, LAMP_LEDC_CH);
#endif
    lamp_apply(false);   // start dim (glowing, not off)
}
#endif

// =============================================================
//  ACTION LAYER  —  >>> PLUG REAL BUTTON BEHAVIOR IN HERE <<<
//
//  One hook per gesture. They are intentionally empty: drop USB-HID,
//  lighting cues, serial/WiFi/OSC messages, etc. inside, keyed off
//  `b.id()` (e.g. BTN_ARCADE_4) or `b.name()`. Central logging + the LED
//  flash are handled in handle_event() below, so keep these pure and
//  non-blocking — no delay(), no busy loops.
//
//  Which hook for which job:
//    on_press / on_release        instant edges — low-latency TRIGGERS,
//                                  and fire-while-held patterns.
//    on_single_click              a confirmed single tap (not a double).
//    on_double_click              two quick taps.
//    on_long_press_start          the moment a HOLD begins.
//    on_hold                      repeats while held — HOLD usage (ramp,
//                                  scroll, repeat-fire, …).
//    on_long_press_stop           the HOLD ends (released).
// =============================================================
static void on_press(const Button &b)            { (void)b; /* TODO */ }
static void on_release(const Button &b)          { (void)b; /* TODO */ }
static void on_single_click(const Button &b)     { (void)b; /* TODO */ }
static void on_double_click(const Button &b)     { (void)b; /* TODO */ }
static void on_long_press_start(const Button &b) { (void)b; /* TODO */ }
static void on_hold(const Button &b)             { (void)b; /* TODO */ }
static void on_long_press_stop(const Button &b)  { (void)b; /* TODO */ }
// =============================================================

// Single event sink for every button: log it, update shared telemetry,
// flash the LED on a press, then route to the matching action hook.
static void handle_event(const Button &b, ButtonEvent ev) {
    panel_log("EVT btn=%s action=%s t=%lu",
              b.name(), button_event_name(ev), (unsigned long)millis());

    telemetry_note((uint8_t)b.id(), ev, millis());

#if BUTTON_LAMP_ENABLED
    // Brighten the lamp to FULL while the source button is down, back to DIM on
    // release. Press == down, Release == up bracket the whole hold lifecycle, so
    // it stays full through LongPressStart/HOLD. ledcWrite is non-blocking.
    if (b.id() == BUTTON_LAMP_SOURCE) {
        if (ev == ButtonEvent::Press)        lamp_apply(true);
        else if (ev == ButtonEvent::Release) lamp_apply(false);
    }
#endif

#if STATUS_LED_ENABLED
    if (ev == ButtonEvent::Press) status_led_flash();
#endif

    switch (ev) {
        case ButtonEvent::Press:          on_press(b);            break;
        case ButtonEvent::Release:        on_release(b);          break;
        case ButtonEvent::SingleClick:    on_single_click(b);     break;
        case ButtonEvent::DoubleClick:    on_double_click(b);     break;
        case ButtonEvent::LongPressStart: on_long_press_start(b); break;
        case ButtonEvent::HoldTick:       on_hold(b);             break;
        case ButtonEvent::LongPressStop:  on_long_press_stop(b);  break;
        default:                                                  break;
    }
}

#if STATUS_LED_ENABLED
static void status_led_update(uint32_t now_ms) {
    static uint32_t last_ms = 0;
    if (now_ms - last_ms < STATUS_LED_REFRESH_MS) return;  // rate-limit redraws
    last_ms = now_ms;

    uint8_t r = 0, g = 0, b = 0;
    if (now_ms < g_flash_until_ms) {
        b = 255;                              // bright blue flash on press
    } else {
        // Slow triangle "breathe" in green as an idle heartbeat.
        const uint32_t half  = STATUS_LED_HEARTBEAT_MS / 2;
        const uint32_t phase = now_ms % STATUS_LED_HEARTBEAT_MS;
        const uint32_t up    = (phase < half) ? phase
                                              : (STATUS_LED_HEARTBEAT_MS - phase);
        g = (uint8_t)(up * 255 / half);
    }
    g_status_led.setPixelColor(0, g_status_led.Color(r, g, b));
    g_status_led.show();
}
#endif

static void print_banner() {
    Serial.println();
    Serial.println(F("==============================================="));
    Serial.printf(  "  %s  v%s\n", FW_NAME, FW_VERSION);
    Serial.println(F("  6-button arcade control panel (ESP32-S3)"));
    Serial.println(F("  gestures: PRESS RELEASE SINGLE_CLICK DOUBLE_CLICK"));
    Serial.println(F("            LONG_PRESS_START HOLD LONG_PRESS_STOP"));
    Serial.println(F("  -- button -> GPIO map --"));
    for (uint8_t i = 0; i < BUTTON_COUNT; ++i) {
        Serial.printf("    %-10s -> GPIO %u\n",
                      g_buttons[i].name(), g_buttons[i].gpio());
    }
#if BUTTON_LAMP_ENABLED
    Serial.printf("  -- lamp: %s -> GPIO %u  (dim %u / full %u) --\n",
                  g_buttons[BUTTON_LAMP_SOURCE].name(), BUTTON_LAMP_PIN,
                  (unsigned)BUTTON_LAMP_DIM, (unsigned)BUTTON_LAMP_FULL);
#endif
    Serial.println(F("==============================================="));
}

void setup() {
    Serial.begin(SERIAL_BAUD);
    log_bus_init();   // create the log queue before anything logs
    // Give a host serial monitor a moment to attach, but never hang
    // forever waiting for one — the panel must also run headless.
    const uint32_t t0 = millis();
    while (!Serial && (millis() - t0) < 1500) { /* spin briefly */ }

    // Build the button objects straight from BUTTON_TABLE in config.h.
    uint8_t i = 0;
#define X(id, gpio) g_buttons[i++].begin(BTN_##id, #id, gpio);
    BUTTON_TABLE(X)
#undef X

#if BUTTON_LAMP_ENABLED
    // GPIO18 drives the illuminated button's lamp via LEDC PWM: a dim glow at
    // rest, full brightness while the source button is held.
    lamp_begin();
#endif

#if STATUS_LED_ENABLED
    g_status_led.begin();
    g_status_led.setBrightness(STATUS_LED_BRIGHTNESS);
    g_status_led.clear();
    g_status_led.show();
#endif

    print_banner();

    // Bring up WiFi (AP + STA), the captive portal, and the telemetry web
    // server in a task pinned to core 0 — the button loop stays on core 1.
    net_portal_begin();
}

void loop() {
    const uint32_t now = millis();

    // Poll every button independently; gestures are emitted through the
    // shared sink as they happen. No delay() anywhere, so all six are
    // responsive and simultaneous-safe.
    for (uint8_t i = 0; i < BUTTON_COUNT; ++i) {
        g_buttons[i].update(now, handle_event);
    }

#if SERIAL_HEARTBEAT_MS > 0
    // Periodic proof-of-life so the link is observable without input.
    static uint32_t last_hb_ms = 0;
    if (now - last_hb_ms >= SERIAL_HEARTBEAT_MS) {
        last_hb_ms = now;
        panel_log("STAT alive t=%lu", (unsigned long)now);
    }
#endif

#if STATUS_LED_ENABLED
    status_led_update(now);
#endif
}
