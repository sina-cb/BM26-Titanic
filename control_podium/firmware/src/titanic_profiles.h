/*
 * titanic_profiles.h — Runtime LoRa profile table + NVS persistence
 * ==================================================================
 *
 * Why this exists
 * ---------------
 * LoRa parameters (spreading factor, bandwidth, coding rate, TX power)
 * are the SAME knobs that decide whether a controller is "right" for
 * the room. A controller flashed for 2-mile playa range will SATURATE
 * the receiver of a peer sitting 1 m away on the bench (RX overload
 * @ ~-25 dBm), and a controller flashed for short-range bench testing
 * will silently drop every frame past the edge of the room.
 *
 * We used to handle this by re-running deploy.py + reflashing every
 * time the scenario changed. That's 30+ seconds round-trip per board,
 * needs a USB cable, and risks half-flashed pairs (server on profile A
 * while captain is still on B → total radio silence).
 *
 * This header lets the controllers carry a SMALL set of named profiles
 * (playa, local, test_bench, …) and switch between them at RUNTIME via
 * a side-channel wire command. The on-air protocol is plaintext (not
 * authenticated by AES-GCM) and gated by a unique 5-byte prefix that
 * legit Titanic v2 frames cannot collide with (frames begin with
 * "T2|"). The trade-off is deliberate:
 *
 *   * Pro: any controller within range can be coerced on demand, no
 *     reflash, no USB needed once the operator chose a new profile in
 *     PortWatch.
 *   * Pro: parameters survive reboot (NVS) — bench tester doesn't
 *     have to re-pick after a power blip.
 *   * Con: an adversary in radio range can switch the link to e.g.
 *     +0 dBm and DOS us. BENCH USE ONLY; do NOT enable in production
 *     RF environments without adding HMAC + replay protection.
 *
 * For now the feature is always-on; the host (bridge or BLE phone) is
 * trusted. See docs/22_server_bridge.md for the wire protocol.
 *
 * Wire format
 * -----------
 * Plain ASCII line, terminated by '\n':
 *
 *   *CFG name=<short> sf=<7-12> bw=<62|125|250|500> cr=<5-8>
 *        hi=<-9..+22> lo=<-9..+22> t=<delay_ms>
 *
 * Spaces separate fields; field order is free; unrecognised fields are
 * ignored (forward-compatible). `t=` is the milliseconds-from-now at
 * which the apply takes effect on the receiver. This delay lets the
 * sender re-transmit the same *CFG a few times before the receiver
 * acts on it, raising the odds the captain hears at least one copy on
 * the OLD profile before it switches to the NEW one.
 *
 * NVS layout
 * ----------
 * Preferences namespace: "tprof"
 * Keys:
 *   "name" (string): last applied profile name (display only)
 *   "sf"   (u8)    : last applied spreading factor
 *   "bw"   (float) : last applied bandwidth in kHz
 *   "cr"   (u8)    : last applied coding rate denominator (5..8)
 *   "hi"   (i8)    : last applied LoRa TX power for HIGH state (dBm)
 *   "lo"   (i8)    : last applied LoRa TX power for LOW state (dBm)
 *
 * Save happens AFTER a successful apply, never before — so if a
 * controller crashes mid-apply it still reboots into the previous
 * working profile.
 */

#ifndef TITANIC_PROFILES_H
#define TITANIC_PROFILES_H

#ifndef ALLOW_PLAINTEXT_PROFILE_CFG
#define ALLOW_PLAINTEXT_PROFILE_CFG 0
#endif

#include <Arduino.h>
#include <Preferences.h>
#include <heltec_unofficial.h>

#include "titanic_pwr.h"

// ── Profile table ──────────────────────────────────────────────────
// Keep this list short (≤8). Each entry is a "named bundle" of LoRa
// knobs that the operator can pick from PortWatch's dropdown without
// remembering numbers. Add new entries by editing this struct + the
// PROFILES[] array; rebuild + reflash; the new name appears in the UI
// on the next /health refresh.
//
// `name` MUST be filesystem-safe (ASCII, ≤14 chars, no whitespace) —
// it's also the NVS persist key and the UI label.

struct LoraProfile {
    const char* name;
    float       bw_khz;
    uint8_t     sf;
    uint8_t     cr;
    int8_t      tx_dbm_high;
    int8_t      tx_dbm_low;
    const char* note;
};

// Curated list. Ordered "short → long range" so the UI dropdown reads
// naturally; the first entry is the recommended default for a fresh
// box (intentionally NOT the longest-range one — we'd rather a new
// operator over-power a saturated bench than under-power an outdoor
// shoot and silently chase ghosts).
static const LoraProfile TITANIC_PROFILES[] = {
    // name           bw     sf  cr  hi   lo   note
    {"test_bench",   500.0,   7,  5,   0,  -9,
        "Short range bench/lab; receivers safe within 1 m"},
    {"local",        250.0,   9,  5,  14,   6,
        "Indoor / venue scale; ~100 m through walls"},
    {"playa",        125.0,  10,  5,  22,  14,
        "Long range; up to ~2 mi LOS with mesh hops"},
};

static constexpr size_t TITANIC_PROFILE_COUNT =
    sizeof(TITANIC_PROFILES) / sizeof(TITANIC_PROFILES[0]);

// ── Runtime state ───────────────────────────────────────────────────
// `_active` is the index into TITANIC_PROFILES that's currently
// applied to the radio (or, on boot before any apply, the index of
// the entry whose params match the compile-time defaults — see
// _titanic_profile_match_compile_default()).
static int           _titanic_profile_active_idx   = -1;
static unsigned long _titanic_profile_pending_at   = 0;       // 0 = none
static int           _titanic_profile_pending_idx  = -1;
static char          _titanic_profile_pending_name[16] = {0}; // for log only

// Forward decls — defined below.
static void _titanic_profile_apply_now(int idx);
static int  _titanic_profile_find_by_name(const char* name);

// ── Helpers ─────────────────────────────────────────────────────────

// Cheap case-sensitive name lookup. Returns -1 if not found.
static int _titanic_profile_find_by_name(const char* name) {
    if (!name) return -1;
    for (size_t i = 0; i < TITANIC_PROFILE_COUNT; ++i) {
        if (strcmp(TITANIC_PROFILES[i].name, name) == 0) {
            return (int)i;
        }
    }
    return -1;
}

// Best-effort: find the profile whose params match the compile-time
// defaults baked in by deploy.py from .config.firmware.yaml. Used on
// first boot before NVS has been written so the OLED + /health row
// don't show "(none)".
static int _titanic_profile_match_compile_default() {
    for (size_t i = 0; i < TITANIC_PROFILE_COUNT; ++i) {
        const LoraProfile& p = TITANIC_PROFILES[i];
        if ((int)p.sf == SF
            && fabsf(p.bw_khz - (float)BANDWIDTH) < 0.5f
            && (int)p.cr == CR
            && (int)p.tx_dbm_high == TX_POWER) {
            return (int)i;
        }
    }
    return -1;
}

// Persist the active profile's NAME ONLY. We deliberately do not
// persist the raw params: a future firmware revision might bump the
// `playa` profile's SF from 10 to 11 and we want the new firmware's
// new params to win on the next boot. Storing only the NAME makes
// firmware-level tuning a no-op for the operator.
static void _titanic_profile_save_nvs(const char* name) {
    Preferences prefs;
    if (!prefs.begin("tprof", false /*RW*/)) {
        Serial.println("PROF: NVS open failed (RW)");
        return;
    }
    prefs.putString("name", name ? name : "");
    prefs.end();
}

// Read persisted profile NAME. Empty string → no preference set.
static String _titanic_profile_load_nvs_name() {
    Preferences prefs;
    if (!prefs.begin("tprof", true /*RO*/)) {
        // First boot ever — namespace doesn't exist yet. Not an error.
        return String();
    }
    String n = prefs.getString("name", "");
    prefs.end();
    return n;
}

// Actually push the profile to the radio. Caller MUST have verified
// idx is in range. Updates the runtime power-profile state so the
// next titanic_pwr_loop() apply uses the new TX dBm. The radio is
// briefly put into standby by the set* calls; we re-arm RX after.
static void _titanic_profile_apply_now(int idx) {
    if (idx < 0 || idx >= (int)TITANIC_PROFILE_COUNT) return;
    const LoraProfile& p = TITANIC_PROFILES[idx];

    Serial.printf(
        "PROF: applying '%s' (sf=%u bw=%.0fkHz cr=4/%u hi=%+d lo=%+d)\n",
        p.name, p.sf, p.bw_khz, p.cr, p.tx_dbm_high, p.tx_dbm_low);

    int rc;
    rc = radio.setBandwidth(p.bw_khz);
    if (rc != 0) Serial.printf("PROF: setBandwidth → rc=%d\n", rc);

    rc = radio.setSpreadingFactor(p.sf);
    if (rc != 0) Serial.printf("PROF: setSpreadingFactor → rc=%d\n", rc);

    rc = radio.setCodingRate(p.cr);
    if (rc != 0) Serial.printf("PROF: setCodingRate → rc=%d\n", rc);

    // Push the new TX dBm into the runtime power profile and refresh.
    titanic_pwr_set_runtime(p.tx_dbm_high, p.tx_dbm_low);

    // Re-arm the receiver — set* calls drop the radio to standby on
    // SX126x. Without this, every controller goes deaf the moment the
    // profile switches and we never hear another packet on the new
    // settings.
    rc = radio.startReceive();
    if (rc != 0) Serial.printf("PROF: startReceive → rc=%d\n", rc);

    _titanic_profile_active_idx = idx;

    // Machine-readable confirmation line for the Pi-side bridge to
    // parse on the server controller's USB-CDC. Closes the
    // bookkeeping loop: regardless of WHO originated the *CFG (USB
    // host = bridge, BLE = captain operator via PortWatch, LoRa peer
    // = relayed from captain), the bridge sees a single `CFG_APPLIED`
    // line and updates its own `_lora_profile_current` so the next
    // PUB carries the correct `prof/<name>` field.
    //
    // On the captain firmware this line is also emitted but nobody is
    // listening to the captain's USB in production — harmless. The
    // dev-laptop HIL scripts can parse it if they want.
    Serial.printf("CFG_APPLIED name=%s\n", p.name);
}

// Public API ─────────────────────────────────────────────────────────

// Apply the profile NAMED `name` IMMEDIATELY (no delay).
// Returns true on success, false if name unknown.
inline bool titanic_profile_apply_by_name(const char* name) {
    int idx = _titanic_profile_find_by_name(name);
    if (idx < 0) {
        Serial.printf("PROF: unknown profile '%s'\n", name ? name : "(null)");
        return false;
    }
    _titanic_profile_apply_now(idx);
    _titanic_profile_save_nvs(TITANIC_PROFILES[idx].name);
    _titanic_profile_pending_at  = 0;
    _titanic_profile_pending_idx = -1;
    return true;
}

// Schedule a profile apply for `delay_ms` milliseconds from now. If a
// schedule already exists, the LATER one wins (most-recent wire
// command represents the most-recent operator intent).
inline bool titanic_profile_schedule_by_name(
    const char* name, unsigned long delay_ms)
{
    int idx = _titanic_profile_find_by_name(name);
    if (idx < 0) {
        Serial.printf("PROF: unknown profile '%s'\n", name ? name : "(null)");
        return false;
    }
    if (delay_ms == 0) {
        return titanic_profile_apply_by_name(name);
    }
    unsigned long deadline = millis() + delay_ms;
    if (_titanic_profile_pending_at != 0 && deadline < _titanic_profile_pending_at) {
        // Older pending lands sooner — keep it. (Tx may have retried
        // with a smaller `t=` for the same target; we want the
        // earliest deadline to win so all peers converge faster.)
        return true;
    }
    _titanic_profile_pending_at  = deadline;
    _titanic_profile_pending_idx = idx;
    strncpy(_titanic_profile_pending_name,
            TITANIC_PROFILES[idx].name,
            sizeof(_titanic_profile_pending_name) - 1);
    _titanic_profile_pending_name[sizeof(_titanic_profile_pending_name) - 1] = '\0';
    Serial.printf("PROF: scheduled '%s' in %lums\n",
                  TITANIC_PROFILES[idx].name, delay_ms);
    return true;
}

// Read current profile name. Always non-null. Returns "(unknown)"
// when the active params don't correspond to any table entry — e.g.
// a developer manually called radio.set*() without going through
// this header. Callers should not free the return.
inline const char* titanic_profile_current_name() {
    int idx = _titanic_profile_active_idx;
    if (idx < 0 || idx >= (int)TITANIC_PROFILE_COUNT) return "(unknown)";
    return TITANIC_PROFILES[idx].name;
}

// Boot-time initialiser. Call AFTER `radio.begin()` so it can replay
// any persisted profile over the compile-time defaults. Safe to call
// even when the firmware has only one profile or when NVS is empty.
inline void titanic_profile_setup() {
    _titanic_profile_active_idx = _titanic_profile_match_compile_default();
    String persisted = _titanic_profile_load_nvs_name();
    if (persisted.length() == 0) {
        if (_titanic_profile_active_idx >= 0) {
            Serial.printf("PROF: using compile-time default '%s'\n",
                TITANIC_PROFILES[_titanic_profile_active_idx].name);
        } else {
            Serial.println(
                "PROF: compile-time params don't match any known profile"
            );
        }
        return;
    }
    int idx = _titanic_profile_find_by_name(persisted.c_str());
    if (idx < 0) {
        // Persisted name was renamed/removed in a newer firmware. Fall
        // back to compile defaults — better than running a phantom
        // profile.
        Serial.printf("PROF: persisted '%s' no longer in table; falling "
                      "back to compile defaults\n", persisted.c_str());
        return;
    }
    if (idx == _titanic_profile_active_idx) {
        // Already matches; nothing to do.
        Serial.printf("PROF: persisted '%s' matches compile defaults\n",
                      persisted.c_str());
        return;
    }
    Serial.printf("PROF: restoring persisted profile '%s'\n",
                  persisted.c_str());
    _titanic_profile_apply_now(idx);
}

// Per-loop tick. Cheap; safe to call every iteration. Applies any
// pending profile change once its deadline arrives.
inline void titanic_profile_loop() {
    if (_titanic_profile_pending_at == 0) return;
    if ((long)(millis() - _titanic_profile_pending_at) < 0) return;
    int idx = _titanic_profile_pending_idx;
    _titanic_profile_pending_at  = 0;
    _titanic_profile_pending_idx = -1;
    if (idx < 0) return;
    _titanic_profile_apply_now(idx);
    _titanic_profile_save_nvs(TITANIC_PROFILES[idx].name);
}

// Parse and act on a wire-format *CFG line (without trailing newline).
// Returns true if the line was consumed (regardless of apply success)
// — caller MUST suppress relaying / serial-printing such lines.
//
// `originated_locally` distinguishes a line we got from our own host
// (USB serial from the bridge, or BLE write from PortWatch) from a
// line we heard relayed over the air. Both paths schedule the apply
// the same way; the only difference is whether we ALSO retransmit
// the line on LoRa (host-originated ones do; relayed ones don't, to
// avoid an infinite echo chamber).
inline bool titanic_profile_handle_cfg_line(
    const char* line, bool originated_locally,
    String* out_relay_payload)
{
    if (!line) return false;
    // Strict prefix gate: "*CFG " — anything else falls through.
    if (strncmp(line, "*CFG ", 5) != 0) return false;

    if (!originated_locally && !ALLOW_PLAINTEXT_PROFILE_CFG) {
        Serial.println("PROF: OTA *CFG rejected (plaintext over LoRa disabled in production)");
        return true;  // consumed so it is not parsed as a frame, but ignored
    }

    char        name_buf[32] = {0};
    unsigned long delay_ms = 0;
    bool got_name = false, got_delay = false;

    // Walk space-separated fields. We tolerate extra fields (sf=,
    // bw=, cr=, hi=, lo=) on the wire even though we don't use them
    // for the lookup — they're informational, and the receiver of a
    // truly forward-compat firmware roll-out will be a few releases
    // behind the sender for a while.
    const char* p = line + 5;
    while (*p) {
        while (*p == ' ') p++;
        if (!*p) break;
        const char* eq = strchr(p, '=');
        if (!eq) break;
        const char* val = eq + 1;
        const char* end = val;
        while (*end && *end != ' ') end++;
        size_t key_len = (size_t)(eq - p);
        size_t val_len = (size_t)(end - val);
        if (key_len == 4 && strncmp(p, "name", 4) == 0) {
            size_t n = val_len < sizeof(name_buf) - 1 ? val_len
                                                     : sizeof(name_buf) - 1;
            memcpy(name_buf, val, n);
            name_buf[n] = '\0';
            got_name = true;
        } else if (key_len == 1 && *p == 't') {
            char tmp[16] = {0};
            size_t n = val_len < sizeof(tmp) - 1 ? val_len : sizeof(tmp) - 1;
            memcpy(tmp, val, n);
            tmp[n] = '\0';
            delay_ms = (unsigned long)strtoul(tmp, nullptr, 10);
            got_delay = true;
        }
        p = end;
    }

    if (!got_name) {
        Serial.println("PROF: *CFG line missing name=; ignored");
        return true;  // consumed (we ate the line) — but no apply
    }
    if (!got_delay) delay_ms = 0;

    titanic_profile_schedule_by_name(name_buf, delay_ms);

    // Local-origin lines get echoed back on LoRa so the captain (peer)
    // sees them. We return the payload string so the caller (which
    // owns the radio TX queue) does the actual transmit — keeping all
    // radio I/O on a single code path avoids reentrancy headaches.
    if (originated_locally && out_relay_payload) {
        *out_relay_payload = String(line);
    }
    return true;
}

#endif  // TITANIC_PROFILES_H
