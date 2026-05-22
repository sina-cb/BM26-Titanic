/*
 * titanic_pwr.h — Client power profile (HIGH/LOW BLE + LoRa TX)
 * ==============================================================
 *
 * Why this exists
 * ---------------
 * Battery-powered Heltec V4 clients sitting idle in a rack pulled
 * noticeable mA running BLE at +9 dBm and LoRa at +22 dBm with nobody
 * talking to them. We default clients to LOW (lower BLE TX, lower
 * LoRa TX, optionally slower SF) and bump to HIGH on real activity:
 *
 *   * BLE central connect      → operator just paired a phone
 *   * BLE characteristic write → phone is actively sending commands
 *   * PRG button press         → operator is at the box, expects fast
 *
 * LoRa RX is deliberately NOT a wake trigger — a packet from another
 * client should not light up the whole mesh; only outbound activity
 * (we're the one TXing) or local interaction wakes us. After
 * PWR_FAST_IDLE_MS of no triggers the client drops back to LOW.
 *
 * Server pinning
 * --------------
 * The server controller (role=server) is built with -DPWR_PIN_HIGH=1
 * by deploy.py and titanic_pwr_setMode() short-circuits straight to
 * HIGH on every call. The server is USB-powered and any latency on
 * a relay between bridge ↔ deck ↔ client meshes is unacceptable —
 * we trade a few mA for guaranteed instant TX power.
 *
 * Why bother sending these as build flags from YAML?
 * --------------------------------------------------
 * Because LoRa TX power, BLE TX power, and the fast-idle timeout are
 * the exact knobs we tune at a venue: "are we hitting the back of the
 * room? bump TX power. Is the controller draining too fast? lower it
 * for the next gig". Surfacing them in .config.firmware.yaml keeps
 * the contract explicit and reflashable without touching C.
 *
 * Public API (call from main.cpp)
 * -------------------------------
 *   titanic_pwr_setup(role)     — call after titanicSetup(). Sets the
 *                                 initial mode based on role.
 *   titanic_pwr_bump()          — call on every activity event (BLE
 *                                 connect, BLE write, PRG press).
 *                                 Cheap; safe to call from BLE
 *                                 callbacks. No-op when pinned HIGH.
 *   titanic_pwr_holdBegin()     — call from BLE onConnect. Latches
 *                                 the client at HIGH as long as
 *                                 >=1 BLE central is connected,
 *                                 regardless of activity bumps.
 *                                 Field need: operator pairs the
 *                                 phone, then walks away to test
 *                                 range; we must NOT drop their
 *                                 TX power to LOW mid-walk just
 *                                 because they haven't tapped a
 *                                 button in 60 s.
 *   titanic_pwr_holdEnd()       — call from BLE onDisconnect.
 *                                 Releases the latch. The normal
 *                                 fast→slow timeout (PWR_FAST_IDLE_MS)
 *                                 then takes over from the time of
 *                                 the last bump.
 *   titanic_pwr_loop()          — call every loop. Handles the
 *                                 fast→slow timeout. No-op when
 *                                 pinned HIGH or while held.
 *   titanic_pwr_isHigh()        — read accessor. Used by the OLED's
 *                                 RADIO page to show the current
 *                                 mode badge.
 *   titanic_pwr_modeLabel()     — "HIGH" / "LOW" for the OLED.
 */

#ifndef TITANIC_PWR_H
#define TITANIC_PWR_H

#include <Arduino.h>
#include <heltec_unofficial.h>
#include <NimBLEDevice.h>

// All build-flag knobs default-mirror .config.firmware.yaml. Anything
// not redefined by deploy.py uses the fallback — keep the values in
// sync with the YAML or the silent drift will bite.
#ifndef PWR_FAST_IDLE_MS
#define PWR_FAST_IDLE_MS 60000UL
#endif
#ifndef PWR_BLE_TX_DBM_HIGH
#define PWR_BLE_TX_DBM_HIGH 9
#endif
#ifndef PWR_BLE_TX_DBM_LOW
#define PWR_BLE_TX_DBM_LOW 3
#endif
#ifndef PWR_LORA_TX_DBM_HIGH
#define PWR_LORA_TX_DBM_HIGH 22
#endif
#ifndef PWR_LORA_TX_DBM_LOW
#define PWR_LORA_TX_DBM_LOW 14
#endif
#ifndef PWR_LORA_SLOW_SF
// 7 = no SF change (keep the radio.spreading_factor). Bump in YAML
// to e.g. 9 to favor range over data rate in LOW mode.
#define PWR_LORA_SLOW_SF 7
#endif
#ifndef PWR_PIN_HIGH
#define PWR_PIN_HIGH 0
#endif
#ifndef PWR_DEBUG_PIN_HIGH
#define PWR_DEBUG_PIN_HIGH 0
#endif
#ifndef PWR_DEBUG_LOG_TRANSITIONS
#define PWR_DEBUG_LOG_TRANSITIONS 0
#endif

// Translate a desired dBm into the closest ESP_PWR_LVL_* enum the
// NimBLE stack accepts. esp_bt.h defines P3=+3, P6=+6, P9=+9, P12=+12,
// P15=+15, P18=+18, P21=+21 (subset varies by chip; ESP32-S3 supports
// the full ladder). We always round DOWN so we never exceed the FCC
// EIRP we sized the antenna for.
static inline esp_power_level_t _titanic_pwr_ble_lvl(int dbm) {
    if (dbm >= 21) return ESP_PWR_LVL_P21;
    if (dbm >= 18) return ESP_PWR_LVL_P18;
    if (dbm >= 15) return ESP_PWR_LVL_P15;
    if (dbm >= 12) return ESP_PWR_LVL_P12;
    if (dbm >=  9) return ESP_PWR_LVL_P9;
    if (dbm >=  6) return ESP_PWR_LVL_P6;
    if (dbm >=  3) return ESP_PWR_LVL_P3;
    if (dbm >=  0) return ESP_PWR_LVL_N0;
    if (dbm >= -3) return ESP_PWR_LVL_N3;
    if (dbm >= -6) return ESP_PWR_LVL_N6;
    if (dbm >= -9) return ESP_PWR_LVL_N9;
    return ESP_PWR_LVL_N12;
}

// State. _isHigh is the source of truth; _lastBumpMs tracks the
// idle countdown; _pinHigh is "compile-time forever" (server) or
// "debug-tune-time forever" (developer override); _bleHeld is the
// dynamic "stay HIGH while a phone is connected" latch.
//
// _bleHeld is a counter, not a bool, because multiple BLE centrals
// can be connected simultaneously (rare on the client side but
// possible: phone + service tool). It only drops to zero when ALL
// of them disconnect. Decrement is clamped at zero so a stray
// onDisconnect callback after a panic-induced reboot can't underflow.
static bool          _titanic_pwr_isHigh = true;
static unsigned long _titanic_pwr_lastBumpMs = 0;
static bool          _titanic_pwr_pinHigh = false;
static bool          _titanic_pwr_initialised = false;
static uint8_t       _titanic_pwr_bleHeld = 0;

// Runtime overrides for the LoRa TX dBm. Default to the compile-time
// YAML values; titanic_profile_apply_now() pokes new numbers in here
// whenever the operator switches profile from PortWatch. Without
// this, _titanic_pwr_apply() would always re-apply the compile-time
// values and silently UNDO the profile change every BLE connect /
// activity bump.
static int _titanic_pwr_lora_dbm_high_rt = PWR_LORA_TX_DBM_HIGH;
static int _titanic_pwr_lora_dbm_low_rt  = PWR_LORA_TX_DBM_LOW;

// Apply the radio + BLE config for `high`. We deliberately set BOTH
// stacks on every transition rather than tracking which is dirty;
// the SET calls are cheap (NimBLE writes a register; SX1262 writes
// a few bytes over SPI) and being unconditional is more debuggable.
static void _titanic_pwr_apply(bool high) {
    int    ble_dbm  = high ? PWR_BLE_TX_DBM_HIGH         : PWR_BLE_TX_DBM_LOW;
    int    lora_dbm = high ? _titanic_pwr_lora_dbm_high_rt
                           : _titanic_pwr_lora_dbm_low_rt;
    NimBLEDevice::setPower(_titanic_pwr_ble_lvl(ble_dbm));
    int rc = radio.setOutputPower(lora_dbm);
    // RADIOLIB_OR_HALT would kill us on a transient failure — be
    // lenient at runtime since the radio is already initialised and
    // a momentary error shouldn't brick the box. Just log.
    if (rc != 0) {
        Serial.printf("PWR: radio.setOutputPower(%d) → rc=%d\n",
                      lora_dbm, rc);
    }
#if PWR_LORA_SLOW_SF != 7
    // Only fiddle with SF if the YAML asked us to. The bridge's
    // syncword math assumes a fixed BW and CR — only SF is safe to
    // switch at runtime without renegotiating with peers (LoRa SF
    // doesn't change the on-air preamble enough to confuse other
    // SF-locked listeners; they just won't decode our payload).
    int new_sf = high ? SF : PWR_LORA_SLOW_SF;
    radio.setSpreadingFactor(new_sf);
#endif
#if PWR_DEBUG_LOG_TRANSITIONS
    Serial.printf("PWR: %s (BLE=%+d dBm, LoRa=%+d dBm)\n",
                  high ? "HIGH" : "LOW", ble_dbm, lora_dbm);
#endif
}

// Public: initialise the profile. Pass the role string (we just check
// it for "server" — keeping it a string keeps the API stable if the
// role list grows). PWR_PIN_HIGH=1 (server build flag) and
// PWR_DEBUG_PIN_HIGH=1 (developer override) both short-circuit to
// HIGH forever.
inline void titanic_pwr_setup(const char* role) {
    _titanic_pwr_pinHigh = (PWR_PIN_HIGH != 0) || (PWR_DEBUG_PIN_HIGH != 0);
    if (!_titanic_pwr_pinHigh && role && strcmp(role, "SERVER_RX") == 0) {
        // Defence in depth: if a server build somehow slipped past
        // without -DPWR_PIN_HIGH=1, the role string check pins it.
        // Costs nothing if the flag is already set.
        _titanic_pwr_pinHigh = true;
    }
    _titanic_pwr_isHigh = true;       // Start in HIGH for fast boot UX.
    _titanic_pwr_lastBumpMs = millis();
    _titanic_pwr_initialised = true;
    _titanic_pwr_apply(true);
    Serial.printf("PWR: setup role=%s pinHigh=%d fast_idle_ms=%lu "
                  "ble_high=%d ble_low=%d lora_high=%d lora_low=%d\n",
                  role ? role : "?",
                  (int)_titanic_pwr_pinHigh,
                  (unsigned long)PWR_FAST_IDLE_MS,
                  PWR_BLE_TX_DBM_HIGH, PWR_BLE_TX_DBM_LOW,
                  PWR_LORA_TX_DBM_HIGH, PWR_LORA_TX_DBM_LOW);
}

// Public: bump the activity timer. Call from:
//   * BLE onConnect    (operator just paired)
//   * BLE onWrite      (phone sent a command — also a real packet)
//   * PRG button       (someone's at the box)
// LoRa RX is deliberately NOT a caller — we don't want a packet from
// another client to wake the whole mesh.
inline void titanic_pwr_bump() {
    if (!_titanic_pwr_initialised) return;
    if (_titanic_pwr_pinHigh) return;
    _titanic_pwr_lastBumpMs = millis();
    if (!_titanic_pwr_isHigh) {
        _titanic_pwr_isHigh = true;
        _titanic_pwr_apply(true);
    }
}

// Public: BLE-connected hold. Called from titanic_ble.h's
// onConnect / onDisconnect callbacks. While held > 0, the
// fast→slow timeout is suppressed: the client stays HIGH for as
// long as a phone is paired, then resumes the normal idle
// timeout from the moment of the last activity bump.
//
// Safe to call when pinned HIGH (server) — it just maintains the
// counter so a future un-pin would behave consistently. Safe to
// call before titanic_pwr_setup() — the counter is just an int.
inline void titanic_pwr_holdBegin() {
    if (_titanic_pwr_bleHeld < 0xFF) _titanic_pwr_bleHeld++;
    // While held the client should be at HIGH — if we're somehow
    // already in LOW (e.g. operator paired AFTER the idle timeout
    // fired) bump now so the upgrade is immediate, not delayed
    // until the next BLE write.
    if (_titanic_pwr_initialised && !_titanic_pwr_pinHigh
        && !_titanic_pwr_isHigh) {
        _titanic_pwr_isHigh = true;
        _titanic_pwr_lastBumpMs = millis();
        _titanic_pwr_apply(true);
    }
}

inline void titanic_pwr_holdEnd() {
    if (_titanic_pwr_bleHeld > 0) _titanic_pwr_bleHeld--;
    // Reset the activity clock on disconnect so the timeout window
    // starts NOW, not from whenever the last BLE write happened
    // 20 minutes ago during the operator's range walk. Without this
    // the box would drop to LOW the instant the phone disconnects.
    if (_titanic_pwr_bleHeld == 0) {
        _titanic_pwr_lastBumpMs = millis();
    }
}

// Public: per-loop tick. Handles the HIGH → LOW timeout. Cheap (one
// millis() compare + a possible apply()) so safe to call every loop.
inline void titanic_pwr_loop() {
    if (!_titanic_pwr_initialised) return;
    if (_titanic_pwr_pinHigh) return;
    if (!_titanic_pwr_isHigh) return;
    // Suppress the timeout while a phone is paired — the operator
    // is actively using the box, the radio MUST stay at full power
    // so a range walk or a multi-step config session isn't
    // silently degraded after 60 s of "no commands sent".
    if (_titanic_pwr_bleHeld > 0) return;
    if (millis() - _titanic_pwr_lastBumpMs >= PWR_FAST_IDLE_MS) {
        _titanic_pwr_isHigh = false;
        _titanic_pwr_apply(false);
    }
}

// Public: status accessors for the OLED + serial diagnostics.
inline bool titanic_pwr_isHigh() { return _titanic_pwr_isHigh; }
inline bool titanic_pwr_isPinned() { return _titanic_pwr_pinHigh; }
inline const char* titanic_pwr_modeLabel() {
    if (_titanic_pwr_pinHigh) return "HIGH*";   // * = pinned
    return _titanic_pwr_isHigh ? "HIGH" : "LOW";
}

// Runtime override of LoRa TX power tiers. Used by titanic_profiles.h
// when the operator switches profile from PortWatch — without this
// the next HIGH/LOW transition would silently undo the change. We
// re-apply immediately so the new TX dBm is in effect on the very
// next packet, not just after the next BLE event.
inline void titanic_pwr_set_runtime(int hi_dbm, int lo_dbm) {
    _titanic_pwr_lora_dbm_high_rt = hi_dbm;
    _titanic_pwr_lora_dbm_low_rt  = lo_dbm;
    if (_titanic_pwr_initialised) {
        _titanic_pwr_apply(_titanic_pwr_isHigh);
    }
}

// Accessor for the current LoRa TX dBm in HIGH state (the value the
// radio is actually configured to right now if the box is in HIGH).
// Used by the OLED RADIO page and /health snapshots.
inline int titanic_pwr_lora_dbm_high() {
    return _titanic_pwr_lora_dbm_high_rt;
}

#endif  // TITANIC_PWR_H
