/*
 * titanic_common.h — Shared Hardware + Multi-Page OLED Display
 * ==============================================================
 * Common init for Heltec V4: Vext, OLED, radio, BLE.
 * Multi-page display: persistent name header + PRG button cycles pages.
 *
 * Layout (128×64 OLED):
 *   ┌──────────────────────────────┐  0px
 *   │ ▪ PODIUM           ■ LNK_1  │  Header (14px) — always visible
 *   ├──────────────────────────────┤ 14px (1px line)
 *   │                              │
 *   │   [  dynamic page content  ] │  Content area (36px)
 *   │                              │
 *   ├──────────────────────────────┤ 50px
 *   │      ○  ●  ○  ○             │  Page dots (14px)
 *   └──────────────────────────────┘ 64px
 *
 * Pages (PRG button cycles):
 *   0: STATUS  — system state + last latency
 *   1: RADIO   — freq, SF, BW, power, RSSI, SNR
 *   2: MSG     — last TX/RX message
 *   3: BLE     — BLE name, connected clients, uptime
 *
 * Usage:
 *   #define DEVICE_ROLE  "PODIUM_TX"
 *   #define DEVICE_SHORT "Podium"
 *   #include "titanic_common.h"
 *   // setup():  titanicSetup();
 *   // loop():   titanicDisplayUpdate();  // call every loop iteration
 */

#ifndef TITANIC_COMMON_H
#define TITANIC_COMMON_H

#include <heltec_unofficial.h>
#include "titanic_ble.h"

// ── Configurable parameters (passed from cli.py) ─────────
#ifndef FREQUENCY
#define FREQUENCY   915.0   // MHz (US ISM)
#define BANDWIDTH   250.0   // kHz
#define SF          7       // Spreading Factor
#define CR          5       // Coding Rate 4/5
#define TX_POWER    22      // dBm
#endif

#ifndef OLED_TIMEOUT_SEC
#define OLED_TIMEOUT_SEC 10
#endif

// ── Display layout constants ─────────────────────────────
#define HDR_H       18      // Header height (larger for 16px font)
#define LINE_Y      18      // Separator line Y
#define CONTENT_Y   20      // Content area start
#define CONTENT_H   30      // Content area height
#define DOTS_Y      53      // Page indicator Y
#define NUM_PAGES   4       // Total pages
#define PRG_BTN     0       // PRG button GPIO (GPIO 0 on Heltec V4)


// ── Global state ─────────────────────────────────────────
TitanicBLE ble;

static uint8_t  _currentPage = 0;
static bool     _linkActive = false;
static String   _lastMsg = "";
static String   _lastMsgDir = "";   // "TX" or "RX"
static float    _lastRssi = 0.0;
static float    _lastSnr = 0.0;
static String   _statusText = "INIT";
static unsigned long _lastActivity = 0;
static unsigned long _lastDisplayUpdate = 0;
static bool     _displayDirty = true;
static bool     _screenAwake = true;

// True hardware interrupt for 100% reliable button detection
volatile bool _btnPressed = false;
volatile unsigned long _btnLastIsr = 0;

void IRAM_ATTR _onBtnISR() {
    unsigned long now = millis();
    if (now - _btnLastIsr > 250) { // 250ms debounce
        _btnPressed = true;
        _btnLastIsr = now;
    }
}



// ── Hardware Setup ───────────────────────────────────────
void titanicSetup() {
    // Enable Vext power (GPIO 36) — powers OLED on Heltec V4
    pinMode(36, OUTPUT);
    digitalWrite(36, LOW);    // LOW = Vext ON
    delay(50);

    heltec_setup();

    // PRG button hardware interrupt
    pinMode(PRG_BTN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PRG_BTN), _onBtnISR, FALLING);

    // Extra display reset in case heltec_setup didn't wake it
    pinMode(RST_OLED, OUTPUT);
    digitalWrite(RST_OLED, HIGH);
    delay(1);
    digitalWrite(RST_OLED, LOW);
    delay(20);
    digitalWrite(RST_OLED, HIGH);
    delay(50);
    display.init();
    display.setContrast(255);
    display.flipScreenVertically();

    both.printf("%s v%s\n", DEVICE_ROLE, FW_VERSION);
    both.println("Initializing radio...");

    RADIOLIB_OR_HALT(radio.begin(FREQUENCY, BANDWIDTH, SF, CR));
    RADIOLIB_OR_HALT(radio.setOutputPower(TX_POWER));

    // Init BLE
    ble.begin(DEVICE_SHORT, DEVICE_ROLE, FREQUENCY, SF, BANDWIDTH, TX_POWER);

    _statusText = "READY";
    _lastActivity = millis();
    _displayDirty = true;
}

// ── Display: Header (always visible) ─────────────────────
static void _drawHeader() {
    // Device name — left aligned, LARGE bold font
    display.setFont(ArialMT_Plain_16);
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    String name = String(DEVICE_SHORT);
    name.toUpperCase();
    display.drawString(2, 0, name);

    // Link indicator — right aligned (small font)
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    if (_linkActive) {
        display.drawString(126, 3, "LNK");
        display.fillRect(109, 6, 5, 5);
    } else {
        display.drawString(126, 3, "---");
        display.drawRect(109, 6, 5, 5);
    }

    // Separator line
    display.drawHorizontalLine(0, LINE_Y, 128);
}

// ── Display: Page dots (bottom) ──────────────────────────
static void _drawPageDots() {
    int totalWidth = NUM_PAGES * 6 + (NUM_PAGES - 1) * 4;
    int startX = (128 - totalWidth) / 2;

    for (int i = 0; i < NUM_PAGES; i++) {
        int x = startX + i * 10;
        if (i == _currentPage) {
            // Active: filled square (6×6)
            display.fillRect(x, DOTS_Y + 2, 6, 6);
        } else {
            // Inactive: small dot (3×3)
            display.fillRect(x + 1, DOTS_Y + 4, 3, 3);
        }
    }
}

// ── Page 0: STATUS ───────────────────────────────────────
static void _drawPageStatus() {
    display.setTextAlignment(TEXT_ALIGN_LEFT);

    // Small label
    display.setFont(ArialMT_Plain_10);
    display.drawString(4, CONTENT_Y, "STATUS");

    // Big status text
    display.setFont(ArialMT_Plain_24);
    display.drawString(4, CONTENT_Y + 10, _statusText);

    // Right side: uptime
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    unsigned long secs = millis() / 1000;
    unsigned long mins = secs / 60;
    unsigned long hrs = mins / 60;
    if (hrs > 0) {
        display.drawString(126, CONTENT_Y + 10, String(hrs) + "h" + String(mins % 60) + "m");
    } else {
        display.drawString(126, CONTENT_Y + 10, String(mins) + "m" + String(secs % 60) + "s");
    }
}

// ── Page 1: RADIO ────────────────────────────────────────
static void _drawPageRadio() {
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.setFont(ArialMT_Plain_10);

    // Left column: radio config
    display.drawString(2, CONTENT_Y,      "RADIO");
    display.drawString(2, CONTENT_Y + 12, String(FREQUENCY, 0) + " MHz");
    display.drawString(2, CONTENT_Y + 22, "SF" + String(SF) + " BW" + String((int)BANDWIDTH));

    // Right column: signal quality
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(126, CONTENT_Y,      String(TX_POWER) + " dBm");

    if (_lastRssi != 0.0) {
        display.drawString(126, CONTENT_Y + 12, "RSSI " + String(_lastRssi, 0));
        display.drawString(126, CONTENT_Y + 22, "SNR  " + String(_lastSnr, 1));
    } else {
        display.drawString(126, CONTENT_Y + 12, "RSSI ---");
        display.drawString(126, CONTENT_Y + 22, "SNR  ---");
    }
}

// ── Page 2: MSG (last message) ───────────────────────────
static void _drawPageMsg() {
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.setFont(ArialMT_Plain_10);

    display.drawString(2, CONTENT_Y,  _lastMsgDir.length() > 0
        ? ("LAST " + _lastMsgDir) : "MESSAGES");

    if (_lastMsg.length() > 0) {
        // Show message (truncated to fit)
        String line1 = _lastMsg.substring(0, 20);
        String line2 = _lastMsg.length() > 20 ? _lastMsg.substring(20, 40) : "";
        display.drawString(2, CONTENT_Y + 12, line1);
        if (line2.length() > 0) {
            display.drawString(2, CONTENT_Y + 22, line2);
        }
    } else {
        display.drawString(2, CONTENT_Y + 14, "No messages yet");
    }

    // Counter on the right
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(126, CONTENT_Y, "TX:" + String(ble.txCount));
    display.drawString(126, CONTENT_Y + 12, "RX:" + String(ble.rxCount));
}

// ── Page 3: BLE ──────────────────────────────────────────
static void _drawPageBle() {
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.setFont(ArialMT_Plain_10);

    display.drawString(2, CONTENT_Y, "BLE");

    String bleName = String("Titanic-") + DEVICE_SHORT;
    display.drawString(2, CONTENT_Y + 12, bleName);
    display.drawString(2, CONTENT_Y + 22, "FW " + String(FW_VERSION));

    // Right side: connection status
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(126, CONTENT_Y + 12, ble.isConnected() ? "PAIRED" : "ADV");
    display.drawString(126, CONTENT_Y + 22, "v" + String(FW_VERSION));
}

// ── Main display render ──────────────────────────────────
static void _renderDisplay() {
    display.clear();
    _drawHeader();

    switch (_currentPage) {
        case 0: _drawPageStatus(); break;
        case 1: _drawPageRadio();  break;
        case 2: _drawPageMsg();    break;
        case 3: _drawPageBle();    break;
    }

    _drawPageDots();
    display.display();
}

// ── Public API ───────────────────────────────────────────

// Call every loop() iteration — handles button + periodic refresh
void titanicDisplayUpdate() {
    // Process ISR button flag
    if (_btnPressed) {
        _btnPressed = false;
        if (!_screenAwake) {
            // Just waking up, eat the button press so we don't skip pages
            _lastActivity = millis();
            _displayDirty = true;
        } else {
            // Active interaction, flip the page
            _currentPage = (_currentPage + 1) % NUM_PAGES;
            _lastActivity = millis();
            _displayDirty = true;
        }
    }

    bool shouldAwake = (OLED_TIMEOUT_SEC <= 0) || ((millis() - _lastActivity) < (OLED_TIMEOUT_SEC * 1000UL));

    if (_screenAwake && !shouldAwake) {
        _screenAwake = false;
        display.clear();     // Purge buffer
        display.display();   // Flush black to screen
    } else if (!_screenAwake && shouldAwake) {
        _screenAwake = true;
        _displayDirty = true;
    }

    if (!_screenAwake) return; // Screen is off, save cycles

    // Refresh display every 500ms or when dirty
    if (_displayDirty || (millis() - _lastDisplayUpdate > 500)) {
        _renderDisplay();
        _lastDisplayUpdate = millis();
        _displayDirty = false;
    }
}

// Called by main when TX succeeds
void titanicOnTX(const String& msg) {
    _lastMsg = msg;
    _lastMsgDir = "TX";
    _statusText = "TX_OK";
    _linkActive = true;
    _displayDirty = true;
}

// Called by main when TX fails
void titanicOnTXFail(const String& msg, int errCode) {
    _lastMsg = msg;
    _lastMsgDir = "TX";
    _statusText = "TX_FAIL";
    _displayDirty = true;
}

// Called by main when RX received
void titanicOnRX(const String& payload, float rssi, float snr) {
    _lastMsg = payload;
    _lastMsgDir = "RX";
    _lastRssi = rssi;
    _lastSnr = snr;
    _statusText = "RX_OK";
    _linkActive = true;
    _displayDirty = true;
}

// Show ready screen on first boot (shows page 0)
void titanicShowReady() {
    _statusText = "READY";
    _displayDirty = true;
    _renderDisplay();
}

// Legacy compat — redirect to new system
void titanicShowTX(int count, const String& msg, bool ok, int errCode = 0) {
    if (ok) titanicOnTX(msg); else titanicOnTXFail(msg, errCode);
}

void titanicShowRX(int count, const String& payload, float rssi, float snr) {
    titanicOnRX(payload, rssi, snr);
}

#endif // TITANIC_COMMON_H
