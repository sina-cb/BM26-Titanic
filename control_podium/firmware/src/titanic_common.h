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
 *   0: STATUS    — big status word + uptime
 *   1: RADIO     — freq, SF, BW, power, RSSI, SNR
 *   2: MSG       — last TX/RX message + lifetime counters
 *   3: BLE INFO  — link state (ADV/CONN/BONDED), node id, FW
 *   4: BLE PIN   — large 6-digit pairing passkey (auto-shown on
 *                  pairing request, regenerated on every boot)
 *   5: BATT      — voltage, %, charge state
 *
 * Display lifecycle (3 stages, see OLED_FULL_SEC / OLED_DIM_SEC):
 *   ACTIVE  — full brightness, full multi-page UI
 *   DIM     — heartbeat page only, low contrast
 *   OFF     — panel blanked
 * Any PRG press or pairing event jumps straight back to ACTIVE.
 *
 * Usage:
 *   #define DEVICE_ROLE  "PODIUM_TX"
 *   #define DEVICE_SHORT "Podium"   // legacy fallback only; the BLE
 *                                   // name comes from BLE_NODE_NAME
 *                                   // (set by firmware/deploy.py from
 *                                   // .config.nodes.yaml).
 *   #include "titanic_common.h"
 *   // setup():  titanicSetup();
 *   // loop():   titanicDisplayUpdate();  // call every loop iteration
 */

#ifndef TITANIC_COMMON_H
#define TITANIC_COMMON_H

#include <heltec_unofficial.h>
#include "titanic_ble.h"
#include "titanic_pwr.h"      // power profile (HIGH/LOW) for BLE+LoRa
#include "titanic_profiles.h" // runtime LoRa profile switching (playa/local/test_bench)

// ── Configurable parameters (override via PlatformIO build flags) ─
// Every constant below is derived from .config.firmware.yaml at flash
// time (see firmware/deploy.py::load_radio_flags). The #ifndef blocks
// here are the "no YAML, no problem" fallback — values MUST mirror
// the defaults in the YAML or a missing YAML key would silently
// drift behavior. Anything you change in the YAML reflashes cleanly
// without touching this file; anything you change here is overridden
// by the YAML on the next deploy.py invocation.
#ifndef FREQUENCY
#define FREQUENCY   915.0   // MHz (US ISM)
#endif
#ifndef BANDWIDTH
// 500 kHz default mirrors .config.firmware.yaml::radio.bandwidth_khz.
// Doubles symbol rate vs the legacy 250 kHz default — halves the
// airtime per `rep` paging frame.
#define BANDWIDTH   500.0   // kHz
#endif
#ifndef SF
#define SF          7       // Spreading Factor
#endif
#ifndef CR
#define CR          5       // Coding Rate 4/5
#endif
#ifndef TX_POWER
// Compile-time DEFAULT for LoRa TX power (dBm). Runtime power
// profile (titanic_pwr.h) mutates this via radio.setOutputPower()
// on every HIGH/LOW transition for clients; server stays pinned
// at TX_POWER for the lifetime of the process.
#define TX_POWER    22
#endif

// ── OLED auto-sleep schedule (3 stages) ─────────────────
// Picked so the user always has a beat to see the screen wake on a
// PRG button press, and so a sleeping board still survives unattended
// for hours of camp use without burning OLED pixels or battery.
//
//   ACTIVE → first OLED_FULL_SEC seconds after activity: full
//            brightness, full multi-page UI.
//   DIM    → for OLED_DIM_SEC seconds after that: contrast dropped to
//            OLED_CONTRAST_DIM, simplified single-screen "heartbeat"
//            (name + uptime + battery). Visible at a glance, draws
//            roughly 10× less average current than ACTIVE.
//   OFF    → after OLED_FULL_SEC + OLED_DIM_SEC: panel blanked. Pixels
//            rest, current draw drops further. Any PRG press jumps
//            straight back to ACTIVE.
//
// All three intervals are sourced from .config.firmware.yaml::oled.
// Set either to 0 in the YAML to keep the screen lit indefinitely
// (debug builds).
#ifndef OLED_FULL_SEC
#define OLED_FULL_SEC 20
#endif
#ifndef OLED_DIM_SEC
#define OLED_DIM_SEC  30
#endif

// ── Identity (compile-time, overridden by build flags) ──
#ifndef NODE_ID
#define NODE_ID 0x01    // 0x01 = server (default); set per role via firmware/deploy.py
#endif

// ── Battery thresholds ──────────────────────────────────
// LiPo cell voltage where we warn / shut down. Values picked to be safely
// above the ESP32-S3 brown-out (~2.93V) and the SX1262 LDO dropout (~3.0V),
// but low enough that the cell is genuinely empty by the time we shut down.
#ifndef BATT_WARN_V
#define BATT_WARN_V 3.40f
#endif
#ifndef BATT_SHUTDOWN_V
#define BATT_SHUTDOWN_V 3.10f
#endif

// How often to sample VBAT. Reading the ADC is fast but it briefly pulls
// VBAT_CTRL low to gate the divider — no point doing it every loop.
// Sourced from .config.firmware.yaml::battery.sample_ms.
#ifndef BATT_SAMPLE_MS
#define BATT_SAMPLE_MS 5000UL
#endif

// ── Display layout constants ─────────────────────────────
// Vertical layout (128×64 OLED):
//   y= 0..15  header (16-px font, advertised name + battery + link dot)
//   y=16      1-px separator
//   y=18..49  content area (32px) — pages render their stuff here
//   y=51..63  page-dot strip (PRG cycles)
#define HDR_H       16      // Header height (16px font + tight baseline)
#define LINE_Y      16      // Separator line Y (just below header)
#define CONTENT_Y   18      // Content area top
#define CONTENT_H   33      // Content area height (51 - 18)
#define DOTS_Y      54      // Page indicator strip Y
#define PRG_BTN     0       // PRG button GPIO (GPIO 0 on Heltec V4)

// Page index assignments. Kept as named constants instead of "magic
// numbers" so the cycle order is reorderable in one place. PIN sits
// next to BLE-INFO so the user can flip between them with a single
// PRG press while reading a pairing prompt.
enum {
    PAGE_STATUS   = 0,
    PAGE_RADIO    = 1,
    PAGE_MSG      = 2,
    PAGE_BLE_INFO = 3,
    PAGE_BLE_PIN  = 4,
    PAGE_BATT     = 5,
    NUM_PAGES     = 6
};

// OLED contrast levels.
//   FULL — fully interactive, used during ACTIVE state.
//   DIM  — dropped to ~12% so the panel is still visible across a
//          dark room but draws much less average current. Going to 0
//          would actually blank the panel (we save that for OFF).
// Sourced from .config.firmware.yaml::oled.contrast_{full,dim}.
#ifndef OLED_CONTRAST_FULL
#define OLED_CONTRAST_FULL  255
#endif
#ifndef OLED_CONTRAST_DIM
#define OLED_CONTRAST_DIM    30
#endif


// ── Global state ─────────────────────────────────────────
TitanicBLE ble;

// 3-stage display lifecycle. See the OLED_FULL_SEC / OLED_DIM_SEC
// block above for what each stage means; transitions are managed in
// titanicDisplayUpdate() based on `millis() - _lastActivity`.
typedef enum {
    DISPLAY_ACTIVE = 0,   // full brightness, full multi-page UI
    DISPLAY_DIM    = 1,   // dim brightness, single heartbeat page
    DISPLAY_OFF    = 2,   // panel blanked entirely
} display_stage_t;

static uint8_t  _currentPage = PAGE_STATUS;
static bool     _linkActive = false;
static String   _lastMsg = "";
static String   _lastMsgDir = "";   // "TX" or "RX"
static float    _lastRssi = 0.0;
static float    _lastSnr = 0.0;
static String   _statusText = "INIT";
static unsigned long _lastActivity = 0;
static unsigned long _lastDisplayUpdate = 0;
static bool     _displayDirty = true;
static display_stage_t _displayStage = DISPLAY_ACTIVE;

// Battery sampling: cached so we don't ADC-thrash and to make multi-page
// rendering cheap. Refreshed on a fixed cadence inside titanicDisplayUpdate().
//
// Battery source classification (best inference without a dedicated VBUS pin):
//   BATT_SRC_UNKNOWN  - never sampled
//   BATT_SRC_NOBATT   - VBAT reads ~0V; cell genuinely absent (running on USB)
//   BATT_SRC_BATT     - VBAT in normal cell range; running on battery (or
//                       USB+full battery floating; we can't tell those apart
//                       without a VBUS sense pin)
//   BATT_SRC_CHARGING - VBAT > 4.18V; only USB can hold a LiPo this high
//   BATT_SRC_LOW      - cell present, < BATT_WARN_V
//   BATT_SRC_CRITICAL - cell present, < BATT_SHUTDOWN_V
typedef enum {
    BATT_SRC_UNKNOWN = 0,
    BATT_SRC_NOBATT,
    BATT_SRC_BATT,
    BATT_SRC_CHARGING,
    BATT_SRC_LOW,
    BATT_SRC_CRITICAL,
} batt_src_t;

// Plausible cell range: anything between this floor and the LDO/charger's
// maximum is "real cell present".
#define BATT_PRESENT_V       1.00f
// "Definitely full / definitely USB" — a LiPo at rest never holds above
// ~4.18V, so anything this high means an active charger is sourcing the
// rail. We pin %=100 in this branch.
#define BATT_FULL_V          4.18f
// "High enough that USB is the most likely explanation" — LiPos under any
// load drift below 4.10V within minutes, so a sustained reading at or above
// this level is almost always USB-attached (or freshly disconnected, which
// resolves cleanly within a few minutes via the downtrend path). We label
// CHRG here too, but report the real % from the discharge curve instead of
// pretending it's 100%. This is the branch that fixes the "shows BATT on
// USB with a near-full cell" failure mode the slope detector misses, since
// a near-full cell on a tail-current charger has essentially no slope.
#define BATT_CHARGING_V      4.10f
// Slope-based USB-charge detection for the mid-cell regime (3.3–4.05V),
// where the charger pulls real current and VBAT climbs measurably. The V4
// has no dedicated VBUS-sense pin, but if VBAT is RISING we know USB is
// connected and the charger is doing work (LiPos do not self-charge). We
// keep a 60s ring buffer and compare newest to oldest. Threshold is +5 mV
// across the window: a real LiPo charger in CC phase pumps 5–10 mV/min,
// well above the 8-sample averaged ADC noise floor (~±2 mV per reading)
// but still high enough to ignore typical discharge drift (~-1 mV/min
// under light load). Once classified CHRG we hysteresize and only fall
// back to BATT on a clearly downward trend, so a momentarily flat sample
// during charging doesn't bounce us back.
#define BATT_TREND_LEN       12          // ~60s of history at 5s sampling
#define BATT_RISE_THRESH_V   0.005f      // +5 mV across window enters CHRG
// 390/100 ohm divider on V3.x/V4: VBAT_actual = ADC_pin * (390+100)/100.
#define BATT_DIVIDER_RATIO   4.9f

static float         _battVolts = 0.0f;
static int           _battPct   = -1;     // -1 = "not measured yet"
static unsigned long _battLastSample = 0;
static batt_src_t    _battSrc   = BATT_SRC_UNKNOWN;
// Ring buffer of recent voltages for slope-based USB detection.
static float         _battTrend[BATT_TREND_LEN] = {0};
static uint8_t       _battTrendCount = 0;    // valid samples (≤ BATT_TREND_LEN)
static uint8_t       _battTrendHead  = 0;    // next write index
// Heltec V3.0/V3.1 ADC_CTRL is active-LOW. V3.2 and V4 reversed it to
// active-HIGH (see Heltec docs and ropg/heltec_esp32_lora_v3 issue #75).
// We probe both polarities once at boot and lock in whichever produced a
// sane reading. -1 = not yet probed; 0 = LOW enables; 1 = HIGH enables.
static int8_t        _battCtrlPolarity = -1;

// True hardware interrupt for 100% reliable button detection.
// We track BOTH press (FALLING) and release (RISING) so the main
// loop can distinguish a tap (cycle pages) from a long-hold (clear
// BLE bonds). Polling once per loop in titanicDisplayUpdate() is
// fine because the ISR latches state and the loop runs ≤ 50 ms.
volatile bool _btnPressed = false;          // tap event for cycle
volatile unsigned long _btnLastIsr = 0;     // FALLING-edge debounce
volatile unsigned long _btnDownAt  = 0;     // start of current hold (0=up)

// Long-press threshold for the "clear all BLE bonds" recovery
// gesture. 5 seconds is long enough that nobody hits it by accident
// while cycling pages, but short enough that a frustrated operator
// staring at "BLE: pairing FAILED" loops will discover it. The OLED
// shows a countdown banner once the hold passes 1 s so the user
// knows something is happening.
#ifndef BLE_BOND_CLEAR_HOLD_MS
#define BLE_BOND_CLEAR_HOLD_MS 5000UL
#endif

void IRAM_ATTR _onBtnISR() {
    // GPIO 0 is INPUT_PULLUP, so it idles HIGH and reads LOW while
    // the user is holding the PRG button.
    int level = digitalRead(PRG_BTN);
    unsigned long now = millis();
    if (level == LOW) {
        // Press edge — debounce against switch bounce.
        if (now - _btnLastIsr > 50) {
            _btnDownAt = now;
            _btnLastIsr = now;
        }
    } else {
        // Release edge — only count as a "press" event (page cycle)
        // if the hold was short. Long-press is handled in the main
        // loop, which polls _btnDownAt continuously.
        unsigned long held = (_btnDownAt > 0) ? (now - _btnDownAt) : 0;
        _btnDownAt = 0;
        if (held >= 50 && held < BLE_BOND_CLEAR_HOLD_MS) {
            _btnPressed = true;
            _btnLastIsr = now;
        }
    }
}


// ── Non-blocking LED flash scheduler ─────────────────────
// We used to follow each TX/RX with `heltec_led(50); delay(30); heltec_led(0);`
// to get a visible blink, but that 30 ms blocks the loop right when we most
// need to re-arm the receiver (after TX) or process the next packet (after RX).
// At 5–10 frames/sec it caused real packet loss and forced a host-side
// `pre_send_delay_s=0.15` workaround. The scheduler below decouples the visual
// pulse from the radio path: `titanicLedFlash(50, 30)` lights the LED, records
// a deadline, and returns immediately. `_ledServiceTask()` (called every loop
// from `titanicDisplayUpdate`) turns it off when the deadline passes.
static unsigned long _ledOffAtMs = 0;

void titanicLedFlash(int brightness, unsigned long duration_ms) {
    heltec_led(brightness);
    unsigned long until = millis() + duration_ms;
    // Overlapping flashes extend rather than clip — a TX immediately
    // followed by an RX still produces one visible pulse rather than a
    // 1ms blip + 30ms pulse with a gap.
    if (until > _ledOffAtMs) _ledOffAtMs = until;
}

static void _ledServiceTask() {
    if (_ledOffAtMs && millis() >= _ledOffAtMs) {
        heltec_led(0);
        _ledOffAtMs = 0;
    }
}



// ── Battery sampling ─────────────────────────────────────
// We do NOT use heltec_vbat() from the library because it hard-codes the
// V3.0/V3.1 ADC_CTRL polarity (drive LOW to enable). On V3.2 and V4 the
// polarity is reversed (drive HIGH to enable) and the library returns 0V on
// those boards. We probe both polarities once at boot and lock in whichever
// returns a non-zero reading. Uses analogReadMilliVolts() for chip-eFuse
// calibration instead of the library's hand-tuned /238.7 constant.

// Read ADC on VBAT_ADC for one polarity choice (0 = LOW, 1 = HIGH).
// Returns measured battery volts (after the 390/100 divider).
static float _readVbatForPolarity(int polarity) {
    pinMode(VBAT_CTRL, OUTPUT);
    digitalWrite(VBAT_CTRL, polarity ? HIGH : LOW);
    delay(10);
    // Average a handful of samples to reduce noise. The ESP32-S3 ADC is
    // notoriously jumpy; 8 samples knocks down ±15mV jitter without adding
    // meaningful latency (analogReadMilliVolts is ~120us).
    uint32_t sum_mv = 0;
    const int N = 8;
    for (int i = 0; i < N; i++) {
        sum_mv += analogReadMilliVolts(VBAT_ADC);
    }
    uint32_t avg_mv = sum_mv / N;
    // Release the control pin so we don't leak current through the divider
    // between samples (it's tied to a high-impedance pull on hardware too).
    pinMode(VBAT_CTRL, INPUT);
    return (avg_mv * BATT_DIVIDER_RATIO) / 1000.0f;
}

// Probe both ADC_CTRL polarities and pick whichever produces a plausible
// reading (i.e. a real LiPo cell voltage between BATT_PRESENT_V and ~4.30V).
// If neither produces a valid reading, leave the polarity set to the V3.2/V4
// default (HIGH) — that way "no battery on USB" still reports cleanly.
static void _probeBattCtrlPolarity() {
    float v_low  = _readVbatForPolarity(0);
    float v_high = _readVbatForPolarity(1);
    bool low_ok  = (v_low  > BATT_PRESENT_V && v_low  < 4.30f);
    bool high_ok = (v_high > BATT_PRESENT_V && v_high < 4.30f);
    if (high_ok) {
        _battCtrlPolarity = 1;
    } else if (low_ok) {
        _battCtrlPolarity = 0;
    } else {
        // Neither reads a cell. Keep V3.2/V4 default; subsequent reads will
        // legitimately return ~0V → classified as NOBATT.
        _battCtrlPolarity = 1;
    }
    Serial.printf("BATT_PROBE: vlow=%.2f vhigh=%.2f -> ctrl_active=%s\n",
                  v_low, v_high, _battCtrlPolarity ? "HIGH (V3.2/V4)" : "LOW (V3.0/V3.1)");
}

// Push the latest reading into the trend ring and return how much VBAT has
// risen across the window (newest - oldest), or 0.0f if we don't have a full
// window yet (so we don't false-trigger CHRG on the first few samples).
static float _battTrendRise(float v_now) {
    _battTrend[_battTrendHead] = v_now;
    _battTrendHead = (_battTrendHead + 1) % BATT_TREND_LEN;
    if (_battTrendCount < BATT_TREND_LEN) {
        _battTrendCount++;
        return 0.0f;
    }
    // Oldest sample is the slot we just overwrote one position ahead.
    float v_old = _battTrend[_battTrendHead];
    return v_now - v_old;
}

// Sample VBAT, classify the power source, and update cached values.
static void _sampleBattery() {
    if (_battCtrlPolarity < 0) {
        _probeBattCtrlPolarity();
    }
    _battVolts = _readVbatForPolarity(_battCtrlPolarity);
    float rise = _battTrendRise(_battVolts);
    batt_src_t prev_src = _battSrc;

    // Classify. Order matters: CRITICAL takes precedence over LOW which takes
    // precedence over CHRG which takes precedence over normal BATT, so the
    // OLED warns even if the cell is technically still present. NOBATT
    // short-circuits everything (no cell to talk about).
    if (_battVolts < BATT_PRESENT_V) {
        _battSrc = BATT_SRC_NOBATT;
        _battPct = -1;
    } else if (_battVolts < BATT_SHUTDOWN_V) {
        _battSrc = BATT_SRC_CRITICAL;
        _battPct = 0;
    } else if (_battVolts < BATT_WARN_V) {
        _battSrc = BATT_SRC_LOW;
        _battPct = heltec_battery_percent(_battVolts);
    } else if (_battVolts >= BATT_FULL_V) {
        // Above ~4.18V can only happen with USB present holding the cell at
        // CV; report CHRG and pin to 100%.
        _battSrc = BATT_SRC_CHARGING;
        _battPct = 100;
    } else if (_battVolts >= BATT_CHARGING_V) {
        // 4.10–4.18V: a resting LiPo drops out of this band within minutes,
        // so a sustained reading here is overwhelmingly USB-attached. Report
        // the real % from the curve rather than a bogus 100%.
        _battSrc = BATT_SRC_CHARGING;
        _battPct = heltec_battery_percent(_battVolts);
    } else if (rise >= BATT_RISE_THRESH_V) {
        // Mid-cell charging: VBAT is climbing through 3.3–4.05V.
        _battSrc = BATT_SRC_CHARGING;
        _battPct = heltec_battery_percent(_battVolts);
    } else if (prev_src == BATT_SRC_CHARGING && rise > -BATT_RISE_THRESH_V) {
        // Hysteresis: once we're confident USB is connected, only fall back
        // to BATT when we see a clear downward trend (cell actually
        // discharging). Flat trend keeps us in CHRG.
        _battSrc = BATT_SRC_CHARGING;
        _battPct = heltec_battery_percent(_battVolts);
    } else {
        _battSrc = BATT_SRC_BATT;
        _battPct = heltec_battery_percent(_battVolts);
    }
    _battLastSample = millis();
}

static bool _battCritical() { return _battSrc == BATT_SRC_CRITICAL; }
static bool _battLow()      { return _battSrc == BATT_SRC_LOW || _battSrc == BATT_SRC_CRITICAL; }
static bool _battPresent()  { return _battSrc != BATT_SRC_NOBATT && _battSrc != BATT_SRC_UNKNOWN; }
static bool _battCharging() { return _battSrc == BATT_SRC_CHARGING; }

// Short label for OLED + serial. NEVER claim "USB POWER" unless we actually
// know there's no cell; otherwise we're inferring and will mislead the user.
static const char* _battSrcLabel() {
    switch (_battSrc) {
        case BATT_SRC_NOBATT:   return "NOBATT";
        case BATT_SRC_CHARGING: return "CHRG";
        case BATT_SRC_CRITICAL: return "CRIT";
        case BATT_SRC_LOW:      return "LOW";
        case BATT_SRC_BATT:     return "BATT";
        default:                return "UNK";
    }
}


// ── Hardware Setup ───────────────────────────────────────
void titanicSetup() {
    // Enable Vext power (GPIO 36) — powers OLED on Heltec V4
    pinMode(36, OUTPUT);
    digitalWrite(36, LOW);    // LOW = Vext ON
    delay(50);

    heltec_setup();

    // PRG button hardware interrupt. CHANGE (not FALLING) so we get
    // both press and release edges — the ISR uses the release edge
    // to commit a "tap" event after measuring how long the user held
    // the button. A pure FALLING-only handler can't distinguish a
    // 200 ms tap from a 5-second hold (the long-press triggers the
    // BLE bond-clear recovery flow).
    pinMode(PRG_BTN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PRG_BTN), _onBtnISR, CHANGE);

    // Extra display reset in case heltec_setup didn't wake it
    pinMode(RST_OLED, OUTPUT);
    digitalWrite(RST_OLED, HIGH);
    delay(1);
    digitalWrite(RST_OLED, LOW);
    delay(20);
    digitalWrite(RST_OLED, HIGH);
    delay(50);
    display.init();
    display.setContrast(OLED_CONTRAST_FULL);
    display.flipScreenVertically();

    both.printf("%s v%s (node=0x%02X)\n", DEVICE_ROLE, FW_VERSION, (unsigned)NODE_ID);
    both.println("Initializing radio...");

    RADIOLIB_OR_HALT(radio.begin(FREQUENCY, BANDWIDTH, SF, CR));
    RADIOLIB_OR_HALT(radio.setOutputPower(TX_POWER));

    // ── LoRa link-quality fixes (diagnostic 2026-05-18) ─────────
    // Without these three, RadioLib's defaults silently knee-cap the
    // +22 dBm path: OCP trips at 60 mA limiting PA current, the LDO
    // regulator can't supply the +22 dBm PA cleanly, and RX runs at
    // "normal" gain mode. Pre-fix bench symptom: RSSI ~-125 dBm at
    // 3 m (~110 dB below the free-space expectation of -15 dBm).
    //
    // setCurrentLimit(140 mA) — SX1262 +22 dBm PA pulls ~120 mA peak;
    // raise the OCP trip with margin so the PA isn't current-starved.
    RADIOLIB_OR_HALT(radio.setCurrentLimit(140));
    // DC-DC regulator is required for high-power TX. LDO (default)
    // cannot supply +22 dBm cleanly even with OCP raised.
    RADIOLIB_OR_HALT(radio.setRegulatorDCDC());
    // Boosted RX gain adds ~3 dB sensitivity at a few mA RX cost.
    // persist=true (default) keeps it across profile-switch set*()
    // calls that drop the radio to standby.
    RADIOLIB_OR_HALT(radio.setRxBoostedGainMode(true));

    // Init BLE
    ble.begin(DEVICE_SHORT, DEVICE_ROLE, FREQUENCY, SF, BANDWIDTH, TX_POWER);

    // Power profile MUST initialise after the radio + BLE stacks are
    // up — the profile applies setPower() / setOutputPower() right
    // away. Server builds (-DPWR_PIN_HIGH=1) are short-circuited to
    // "HIGH forever" inside titanic_pwr_setup() so the rest of the
    // code path is identical on both roles.
    titanic_pwr_setup(DEVICE_ROLE);

    // LoRa profile (playa/local/test_bench/…) MUST initialise after
    // the radio is configured: titanic_profile_setup() replays any
    // persisted profile from NVS over the compile-time defaults, so
    // a box that was switched to test_bench yesterday comes up at
    // test_bench today without the operator having to redo the
    // PortWatch dropdown. See titanic_profiles.h for the wire format.
    titanic_profile_setup();

    // First battery sample at boot so the header can show something useful.
    _sampleBattery();

    _statusText = "READY";
    _lastActivity = millis();
    _displayDirty = true;
}

// ── Display: Header (always visible) ─────────────────────
// Layout, left → right:
//   [BLE name (lower-case, exactly as advertised)]   [batt% / USB / CHRG]
// followed by a 1-px separator at LINE_Y.
//
// Showing the BLE name (e.g. "tcon_captain") rather than the legacy
// DEVICE_SHORT label means the operator can confirm at a glance that
// the iPhone is talking to the right physical box — the string on
// screen is identical to the string in iOS's BLE picker.
static void _drawHeader() {
    display.setFont(ArialMT_Plain_16);
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(2, 0, ble.getBleName());

    // Right side: tiny battery indicator (small font, top row).
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    if (_battSrc == BATT_SRC_NOBATT) {
        display.drawString(126, 0, "USB");
    } else if (_battSrc == BATT_SRC_CHARGING) {
        display.drawString(126, 0, "CHRG");
    } else if (_battPct >= 0) {
        display.drawString(126, 0, String(_battPct) + "%");
    }

    // 1-px separator under the header.
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

// ── Helper: human-readable uptime string ─────────────────
// Picks the most-significant useful unit so a 30s screenshot reads
// "30s" not "0h0m30s", and a multi-hour camp uptime reads "3h12m"
// not "192m". Reused by STATUS and DIM screens.
static String _fmtUptime() {
    unsigned long secs = millis() / 1000;
    unsigned long mins = secs / 60;
    unsigned long hrs  = mins / 60;
    char buf[24];
    if (hrs > 0) {
        snprintf(buf, sizeof(buf), "%luh %02lum", hrs, mins % 60);
    } else if (mins > 0) {
        snprintf(buf, sizeof(buf), "%lum %02lus", mins, secs % 60);
    } else {
        snprintf(buf, sizeof(buf), "%lus", secs);
    }
    return String(buf);
}

// ── Page 0: STATUS ───────────────────────────────────────
// Headline page. Big status word, small "uptime" label below.
static void _drawPageStatus() {
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.setFont(ArialMT_Plain_10);
    display.drawString(2, CONTENT_Y, "STATUS");

    // Big status text — center-vertically in the content band.
    display.setFont(ArialMT_Plain_24);
    display.drawString(2, CONTENT_Y + 8, _statusText);

    // Right column: live uptime, tiny, bottom-right of content.
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(126, CONTENT_Y, "up");
    display.drawString(126, CONTENT_Y + 12, _fmtUptime());
}

// ── Page 1: RADIO ────────────────────────────────────────
// Two-column layout: cfg on the left (freq/SF/BW), live link on the
// right (TX power / RSSI / SNR). Aligned grid so the eye locks on
// fast — useful when watching a range walk.
static void _drawPageRadio() {
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(2, CONTENT_Y,      "RADIO");
    display.drawString(2, CONTENT_Y + 11, String(FREQUENCY, 0) + " MHz");
    display.drawString(2, CONTENT_Y + 22, "SF" + String(SF) + " BW" + String((int)BANDWIDTH));

    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    // Right-column line 1: live TX power AND the current power mode
    // ("HIGH" / "LOW" / "HIGH*" for pinned-server). Lets the operator
    // confirm at a glance whether the controller is on the fast path
    // or sipping battery — the most-common diagnostic when the user
    // says "it feels sluggish".
    display.drawString(126, CONTENT_Y,
        String(TX_POWER) + " dBm " + String(titanic_pwr_modeLabel()));
    if (_lastRssi != 0.0) {
        display.drawString(126, CONTENT_Y + 11, "RSSI " + String(_lastRssi, 0));
        display.drawString(126, CONTENT_Y + 22, "SNR  " + String(_lastSnr, 1));
    } else {
        display.drawString(126, CONTENT_Y + 11, "RSSI --");
        display.drawString(126, CONTENT_Y + 22, "SNR  --");
    }
}

// ── Page 2: MSG (last message) ───────────────────────────
// Top row carries the section label on the left and the live TX/RX
// counters on the right; the rest of the band is a 2-line message
// preview (truncated to fit so we never wrap mid-glyph).
static void _drawPageMsg() {
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(2, CONTENT_Y, _lastMsgDir.length() > 0
        ? ("LAST " + _lastMsgDir) : "MESSAGES");

    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(126, CONTENT_Y, "TX " + String(ble.txCount) +
                                       "  RX " + String(ble.rxCount));

    display.setTextAlignment(TEXT_ALIGN_LEFT);
    if (_lastMsg.length() > 0) {
        String line1 = _lastMsg.substring(0, 20);
        String line2 = _lastMsg.length() > 20 ? _lastMsg.substring(20, 40) : "";
        display.drawString(2, CONTENT_Y + 11, line1);
        if (line2.length() > 0) {
            display.drawString(2, CONTENT_Y + 22, line2);
        }
    } else {
        display.drawString(2, CONTENT_Y + 16, "no messages yet");
    }
}

// State labels for the BLE pages. Three states the user can debug
// from across the room:
//   ADV    — advertising, no central connected yet
//   CONN   — at least one central connected, none authenticated
//   BONDED — at least one central paired & encrypted (commands flow)
static const char* _bleStateLabel() {
    if (!ble.isConnected())      return "ADV";
    if (!ble.isAuthenticated())  return "CONN";
    return "BONDED";
}

// ── Page 3: BLE INFO ─────────────────────────────────────
// Compact dashboard for "what is this BLE radio doing right now?".
// State word on the left, identity (node id + FW) on the right. PIN
// lives on its own page (next press of PRG) so this one stays
// uncluttered enough to read at a glance.
//
// Multi-link aware: when 2+ centrals are connected we append a small
// "(n)" after the state word so the operator can see at a glance how
// many phones/iPads are talking to this controller right now. Single-
// link case stays uncluttered (no number).
static void _drawPageBleInfo() {
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(2, CONTENT_Y, "BLE");

    // Big state word, vertically centered in the content band.
    display.setFont(ArialMT_Plain_16);
    display.drawString(2, CONTENT_Y + 11, _bleStateLabel());

    // Multi-link badge ("·2", "·3" …). Only shown when there are
    // 2+ links, otherwise the layout is identical to single-link
    // mode for backward visual familiarity.
    const uint8_t connCount = ble.connectedCount();
    if (connCount >= 2) {
        display.setFont(ArialMT_Plain_10);
        char badge[8];
        snprintf(badge, sizeof(badge), "·%u", (unsigned)connCount);
        display.drawString(56, CONTENT_Y + 16, badge);
    }

    // Right column: identity. Two short lines so neither has to
    // truncate at NODE_ID > 0xFF (we never go that high, but layout
    // shouldn't depend on it).
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    char idbuf[16];
    snprintf(idbuf, sizeof(idbuf), "node 0x%02X", (unsigned)NODE_ID);
    display.drawString(126, CONTENT_Y, idbuf);
    display.drawString(126, CONTENT_Y + 22, "FW " + String(FW_VERSION));
}

// ── Page 4: BLE PIN ──────────────────────────────────────
// Dedicated page for the pairing passkey. Drawn deliberately empty-
// looking so the eye lands on the digits — no header label, no side
// columns, just "PIN" small and the 6 digits HUGE and centered.
//
// When iOS pops its "enter passkey" prompt we auto-jump to this page
// (see titanicDisplayUpdate's consumePairingRequest hook). If the
// user manually browsed here outside of pairing, they get to admire
// the PIN — harmless because the pairing PIN regenerates on every
// boot and the link is useless without an active pairing handshake.
static void _drawPageBlePin() {
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_CENTER);
    display.drawString(64, CONTENT_Y, "PAIRING PIN");

    // Huge centered digits. ble.getPasskeyStr() is always 6 chars
    // (zero-padded) so the layout doesn't jump between e.g. 042193
    // and 942193.
    display.setFont(ArialMT_Plain_24);
    display.drawString(64, CONTENT_Y + 9, ble.getPasskeyStr());
}

// ── Page 4: BATTERY ──────────────────────────────────────
// Always-visible battery readout. This is what most users will actually look
// at to decide "should I plug in or not". Big number, voltage, source state.
static void _drawPageBatt() {
    display.setTextAlignment(TEXT_ALIGN_LEFT);

    // Small label
    display.setFont(ArialMT_Plain_10);
    display.drawString(4, CONTENT_Y, "BATTERY");

    // Big percentage on the left, OR "USB" if no cell present so we don't
    // imply 0% charge when there's just no battery wired up.
    display.setFont(ArialMT_Plain_24);
    if (_battSrc == BATT_SRC_NOBATT) {
        display.drawString(4, CONTENT_Y + 8, "USB");
    } else if (_battPct < 0) {
        display.drawString(4, CONTENT_Y + 8, "--%");
    } else {
        display.drawString(4, CONTENT_Y + 8, String(_battPct) + "%");
    }

    // Right column: voltage + source/state label.
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    if (_battSrc == BATT_SRC_NOBATT) {
        display.drawString(126, CONTENT_Y,      "NO CELL");
        display.drawString(126, CONTENT_Y + 12, "USB ONLY");
    } else {
        char vbuf[12];
        snprintf(vbuf, sizeof(vbuf), "%.2f V", _battVolts);
        display.drawString(126, CONTENT_Y, vbuf);
        display.drawString(126, CONTENT_Y + 12, _battSrcLabel());
    }
}

// ── Main display render ──────────────────────────────────
static void _renderDisplay() {
    display.clear();
    _drawHeader();

    switch (_currentPage) {
        case PAGE_STATUS:   _drawPageStatus();  break;
        case PAGE_RADIO:    _drawPageRadio();   break;
        case PAGE_MSG:      _drawPageMsg();     break;
        case PAGE_BLE_INFO: _drawPageBleInfo(); break;
        case PAGE_BLE_PIN:  _drawPageBlePin();  break;
        case PAGE_BATT:     _drawPageBatt();    break;
    }

    _drawPageDots();
    display.display();
}

// Minimal "heartbeat" view used when the device is in the DIM stage.
// We do NOT fully blank the screen — the user's biggest UX complaint
// is "I can't tell if the device is alive". Instead we drop contrast
// and render NAME + BATT + UPTIME so it's clearly alive at a glance,
// at much lower average power.
static void _renderDim() {
    display.clear();

    display.setFont(ArialMT_Plain_16);
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(2, 0, ble.getBleName());

    // Battery (top-right). Same labels as the main header for a
    // consistent at-a-glance signal across all stages.
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    if (_battSrc == BATT_SRC_NOBATT) {
        display.drawString(126, 0, "USB");
    } else if (_battSrc == BATT_SRC_CHARGING) {
        display.drawString(126, 0, "CHRG");
    } else if (_battPct >= 0) {
        display.drawString(126, 0, String(_battPct) + "%");
    }

    // Big centered uptime — the "is this thing alive?" signal.
    display.setFont(ArialMT_Plain_16);
    display.setTextAlignment(TEXT_ALIGN_CENTER);
    display.drawString(64, 22, "up " + _fmtUptime());

    // Subtle hint that PRG brings the full UI back. Goes away in OFF
    // stage because the screen will literally be blanked.
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_CENTER);
    display.drawString(64, 48, "press PRG for more");

    display.display();
}

// Stage 3: physically blank the panel. We keep the OLED powered so we
// can wake fast (sub-millisecond compared to a re-init), but the
// framebuffer goes empty and contrast drops to 0. Any PRG press or
// pairing event in titanicDisplayUpdate() pulls us back to ACTIVE.
static void _renderOff() {
    display.clear();
    display.display();
}

// ── Public API ───────────────────────────────────────────

// Call every loop() iteration — handles button + periodic refresh + battery.
void titanicDisplayUpdate() {
    // ── Service the non-blocking LED scheduler ─────────────────
    // Cheap (one millis() compare in the common case); see comment above
    // titanicLedFlash() for why this replaced the old delay(30) pattern.
    _ledServiceTask();

    // ── Periodic battery sample ────────────────────────────────
    if (millis() - _battLastSample > BATT_SAMPLE_MS) {
        _sampleBattery();
        _displayDirty = true;
        // Periodic readout on serial so the host can verify the battery
        // path without looking at the OLED. Distinct prefix (BATT:) so the
        // companion serial parser ignores it (it only consumes RX:/TX_*).
        // Window rise lets a host see the slope-based USB detection in
        // action. Will be 0.00 until the trend buffer fills (~30s of uptime).
        float rise_disp = (_battTrendCount >= BATT_TREND_LEN)
                          ? (_battVolts - _battTrend[_battTrendHead])
                          : 0.0f;
        Serial.printf("BATT: pct=%d v=%.2f src=%s rise=%+.3fV\n",
                      _battPct, _battVolts, _battSrcLabel(), rise_disp);
        // Critical battery: shut down cleanly so we don't brown-out cycle.
        // _battCritical() returns true only when src==CRITICAL, which already
        // requires a present cell — no false-fire on USB-only.
        if (_battCritical()) {
            display.setContrast(OLED_CONTRAST_FULL);
            display.clear();
            display.setFont(ArialMT_Plain_16);
            display.setTextAlignment(TEXT_ALIGN_CENTER);
            display.drawString(64, 8,  "LOW BATTERY");
            display.setFont(ArialMT_Plain_10);
            char vbuf[16];
            snprintf(vbuf, sizeof(vbuf), "%.2f V", _battVolts);
            display.drawString(64, 28, vbuf);
            display.drawString(64, 42, "SHUTTING DOWN");
            display.display();
            Serial.printf("BATT_SHUTDOWN: %.2fV\n", _battVolts);
            delay(1500);
            // heltec_deep_sleep() is the cleanest exit — it powers down the
            // radio, OLED, and pins, leaving the chip in ultra-low-power. The
            // user power-cycles to revive (USB plug-in resets the chip).
            heltec_deep_sleep();
            // (does not return)
        }
    }

    // ── Pairing-event hooks (wake-on-PIN, refresh-on-bond) ─────
    // Polled every loop. consumePairingRequest() / consumePairingDone()
    // are atomic read-and-clear so we never miss an event nor process
    // it twice.
    if (ble.consumePairingRequest()) {
        // iOS just popped its passkey prompt. Wake the screen and
        // jump straight to the PIN page so the user can read the
        // digits without poking PRG.
        _currentPage = PAGE_BLE_PIN;
        _lastActivity = millis();
        _displayStage = DISPLAY_ACTIVE;
        display.setContrast(OLED_CONTRAST_FULL);
        _displayDirty = true;
    }
    if (ble.consumePairingDone()) {
        // Bond complete (or failed). Bounce to BLE INFO so the user
        // sees BONDED / ADV reflect the new state. Stay awake briefly
        // so the success is visible, then the normal idle timer takes
        // over from here.
        _currentPage = PAGE_BLE_INFO;
        _lastActivity = millis();
        _displayStage = DISPLAY_ACTIVE;
        display.setContrast(OLED_CONTRAST_FULL);
        _displayDirty = true;
    }

    // ── Long-press: clear ALL BLE bonds (recovery gesture) ─────
    // The most common BLE failure in the field is a stale bond:
    // user reflashed the controller but the iPhone still thinks it
    // has a valid LTK, so the encrypt-only fast-path fails and the
    // controller can't pair without the user manually "Forget This
    // Device" on the phone. The other failure mode is the bond
    // store on the controller filling up, evicting working bonds.
    //
    // Holding PRG for ≥5 s wipes the controller's bond store and
    // restarts advertising. The OLED shows a countdown banner once
    // the hold passes 1 s so the user can confirm or release.
    {
        unsigned long downAt = _btnDownAt;  // snapshot volatile
        if (downAt > 0) {
            unsigned long held = millis() - downAt;
            if (held >= 1000UL && held < BLE_BOND_CLEAR_HOLD_MS) {
                // Show the countdown overlay. We render directly here
                // (bypassing the page renderer) so the user sees it
                // even if they were on a different page before.
                display.clear();
                display.setFont(ArialMT_Plain_10);
                display.setTextAlignment(TEXT_ALIGN_CENTER);
                display.drawString(64, 4, "RELEASE TO CANCEL");
                display.setFont(ArialMT_Plain_16);
                int remain_s = (int)((BLE_BOND_CLEAR_HOLD_MS - held + 999) / 1000);
                char buf[24];
                snprintf(buf, sizeof(buf), "CLEAR BONDS %ds", remain_s);
                display.drawString(64, 22, buf);
                display.setFont(ArialMT_Plain_10);
                display.drawString(64, 48, "all phones must re-pair");
                display.display();
                _displayStage = DISPLAY_ACTIVE;
                _lastActivity = millis();
            } else if (held >= BLE_BOND_CLEAR_HOLD_MS) {
                // Threshold reached — wipe all bonds. NimBLEDevice
                // exposes a one-shot delete-all that walks the store
                // and erases every entry; cheaper than tracking and
                // deleting per-MAC. Restart advertising afterwards
                // so the controller is immediately discoverable.
                int n = NimBLEDevice::deleteAllBonds();
                Serial.printf("BLE: long-press detected, cleared %d bonds — phones will need to re-pair\n", n);
                NimBLEDevice::startAdvertising();
                // Confirmation toast: held for ~1.5 s so it's
                // unmissable, then the normal page renderer takes
                // over again.
                display.clear();
                display.setFont(ArialMT_Plain_16);
                display.setTextAlignment(TEXT_ALIGN_CENTER);
                display.drawString(64, 8, "BONDS CLEARED");
                display.setFont(ArialMT_Plain_10);
                char nbuf[24];
                snprintf(nbuf, sizeof(nbuf), "removed %d device(s)", n);
                display.drawString(64, 30, nbuf);
                display.drawString(64, 46, "re-pair from phone");
                display.display();
                delay(1500);
                // Eat the eventual release-edge "tap" event so the
                // user doesn't accidentally cycle pages on let-go.
                _btnPressed = false;
                _btnDownAt = 0;
                _currentPage = PAGE_BLE_INFO;
                _lastActivity = millis();
                _displayDirty = true;
            }
        }
    }

    // ── Process ISR button flag ────────────────────────────────
    // ANY press wakes us out of DIM/OFF without also flipping the
    // page (that would be confusing — "I just woke the screen and it
    // already changed pages"). A press from ACTIVE cycles pages.
    if (_btnPressed) {
        _btnPressed = false;
        // The user is physically at the box → bump to HIGH so the
        // next BLE/LoRa exchange is on max TX. Cheap, idempotent,
        // no-op when pinned (server). This is the wake trigger the
        // user observed in the field ("pressed a button and the
        // connection got fast again").
        titanic_pwr_bump();
        if (_displayStage != DISPLAY_ACTIVE) {
            _displayStage = DISPLAY_ACTIVE;
            display.setContrast(OLED_CONTRAST_FULL);
            _lastActivity = millis();
            _displayDirty = true;
        } else {
            _currentPage = (_currentPage + 1) % NUM_PAGES;
            _lastActivity = millis();
            _displayDirty = true;
        }
    }

    // ── Per-loop power-profile tick ────────────────────────────
    // Cheap: one millis() compare in the common (still-HIGH) case.
    // Drops the client from HIGH → LOW after PWR_FAST_IDLE_MS of no
    // bumps. Server builds (PWR_PIN_HIGH=1) return immediately.
    titanic_pwr_loop();

    // ── 3-stage idle timeout: ACTIVE → DIM → OFF ───────────────
    // Setting either threshold to 0 disables that transition (and
    // everything beyond it), so a debug build can keep the screen on
    // forever with -DOLED_FULL_SEC=0.
    unsigned long idleMs = millis() - _lastActivity;
    unsigned long fullMs = (unsigned long)OLED_FULL_SEC * 1000UL;
    unsigned long dimMs  = (unsigned long)OLED_DIM_SEC  * 1000UL;

    if (_displayStage == DISPLAY_ACTIVE && OLED_FULL_SEC > 0 && idleMs >= fullMs) {
        _displayStage = DISPLAY_DIM;
        display.setContrast(OLED_CONTRAST_DIM);
        _displayDirty = true;
    } else if (_displayStage == DISPLAY_DIM && OLED_DIM_SEC > 0 && idleMs >= (fullMs + dimMs)) {
        _displayStage = DISPLAY_OFF;
        display.setContrast(0);
        _displayDirty = true;
    }

    // ── Render dispatch ────────────────────────────────────────
    // 500 ms refresh cadence keeps DIM uptime ticking and ACTIVE
    // counters live. OFF state still ticks so any state change (e.g.
    // pairing event) has a path to repaint.
    if (_displayDirty || (millis() - _lastDisplayUpdate > 500)) {
        switch (_displayStage) {
            case DISPLAY_ACTIVE: _renderDisplay(); break;
            case DISPLAY_DIM:    _renderDim();     break;
            case DISPLAY_OFF:    _renderOff();     break;
        }
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
