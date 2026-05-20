/*
 * titanic_ble.h — Shared BLE GATT Server for Titanic Control Podium
 * ===================================================================
 * Exposes device info, radio stats, and LoRa config over BLE.
 * Also accepts commands via BLE write (phone → LoRa).
 *
 * Usage:
 *   #include "titanic_ble.h"
 *   // In setup():  ble.begin("Podium", "PODIUM_TX", ...);
 *   // In loop():   ble.update();
 *   //              if (ble.hasCommand()) { String cmd = ble.popCommand(); ... }
 *   // On RX:       ble.onPacket(rssi, snr);
 *   // On TX:       ble.onTransmit();
 *
 * Phone:
 *   1. Open nRF Connect (iOS/Android)
 *   2. Scan for "Titanic-Podium" or "Titanic-Server"
 *   3. Tap Connect
 *   4. Read characteristics for stats
 *   5. Write to Command characteristic to send LoRa messages
 */

#ifndef TITANIC_BLE_H
#define TITANIC_BLE_H

#include <NimBLEDevice.h>
#include <heltec_unofficial.h>

// ── BLE UUIDs ─────────────────────────────────────────────
#define TITANIC_SERVICE_UUID      "a0e3f001-1c3d-4b60-a0e3-000000000000"
#define CHAR_ROLE_UUID            "a0e3f001-1c3d-4b60-a0e3-000000000001"
#define CHAR_FW_VER_UUID          "a0e3f001-1c3d-4b60-a0e3-000000000002"
#define CHAR_UPTIME_UUID          "a0e3f001-1c3d-4b60-a0e3-000000000003"
#define CHAR_TX_COUNT_UUID        "a0e3f001-1c3d-4b60-a0e3-000000000010"
#define CHAR_RX_COUNT_UUID        "a0e3f001-1c3d-4b60-a0e3-000000000011"
#define CHAR_LAST_RSSI_UUID       "a0e3f001-1c3d-4b60-a0e3-000000000012"
#define CHAR_LAST_SNR_UUID        "a0e3f001-1c3d-4b60-a0e3-000000000013"
#define CHAR_FREQ_UUID            "a0e3f001-1c3d-4b60-a0e3-000000000020"
#define CHAR_SF_UUID              "a0e3f001-1c3d-4b60-a0e3-000000000021"
#define CHAR_BW_UUID              "a0e3f001-1c3d-4b60-a0e3-000000000022"
#define CHAR_TXPOW_UUID           "a0e3f001-1c3d-4b60-a0e3-000000000023"
// Command (write from phone → triggers LoRa TX)
#define CHAR_CMD_UUID             "a0e3f001-1c3d-4b60-a0e3-000000000030"
// Last RX payload (read — see what the server received)
#define CHAR_LAST_RX_UUID         "a0e3f001-1c3d-4b60-a0e3-000000000031"

#define FW_VERSION "1.6-multi-ble"

// ── BLE advertised name source ─────────────────────────────────────
// Preferred: deploy.py reads `name:` from .config.nodes.yaml and
// passes it as a build flag, e.g. `-DBLE_NODE_NAME="captain"` for node
// 0x0A. The firmware then advertises itself as `tcon_captain`. Per-board
// names mean the operator can distinguish two captains visually
// without inspecting node id bytes — useful on a crowded mesh.
//
// Fallback: a plain `pio run` (no deploy.py) builds with a generic
// name like `tcon_node` so the firmware still functions but isn't
// pretending to be any specific board. That keeps "I just want to
// re-flash to test a code change" workflows unbroken.
#ifndef BLE_NODE_NAME
#define BLE_NODE_NAME "node"
#endif

// ── Command queue (shared between BLE callback and main loop) ──
//
// Previously this was a single-slot buffer (`_ble_cmd_buffer` + a
// `_ble_pending_cmd` bool). Two BLE writes landing in the same
// FreeRTOS loop tick — easy to trigger when PortWatch's status
// poller fires while an operator taps a pattern — would overwrite
// the first command before the main loop could pop it, silently
// losing it.
//
// Replaced with a small fixed-capacity ring queue. The BLE
// onWrite callback (always on the NimBLE host task) pushes; the
// main loop pops at LoRa-transmit rate. The two indices are
// updated atomically on the ESP32-S3 (32-bit aligned writes), and
// since only the callback ever pushes and only the main loop
// ever pops, no further locking is needed.
//
// Capacity sized for the worst case: PortWatch's three pollers
// firing simultaneously plus an operator tap = 4 frames queued.
// 8 gives 2x headroom without burning RAM (8 * 256 byte String =
// 2 KB worst case, but Strings are dynamically allocated so the
// idle cost is just the array overhead).
#ifndef BLE_CMD_QUEUE_CAPACITY
#define BLE_CMD_QUEUE_CAPACITY 8
#endif
static String _ble_cmd_queue[BLE_CMD_QUEUE_CAPACITY];
static volatile uint8_t _ble_cmd_q_head = 0;  // next slot to pop
static volatile uint8_t _ble_cmd_q_tail = 0;  // next slot to push
// Dropped-write counter exposed for the serial log when the queue
// overflows — operator can spot when the link is so slow that we
// can't drain BLE writes fast enough.
static volatile uint16_t _ble_cmd_q_dropped = 0;

// ── Active connection bookkeeping ─────────────────────────────────
// We support multiple simultaneous centrals (iPhone + iPad + spare;
// see CONFIG_BT_NIMBLE_MAX_CONNECTIONS in platformio.ini). The legacy
// single-boolean state is unsafe with multi-link because "connected"
// vs "authenticated" only makes sense per-link, not globally.
//
// `_ble_active_connections`         : count of links the controller
//                                      is holding right now.
// `_ble_authenticated_connections`  : count of those that completed
//                                      the passkey-display pairing
//                                      and are running with an
//                                      encrypted link.
//
// The display layer ("connected? authenticated?") consumes booleans
// derived from these counts via `isConnected()` / `isAuthenticated()`.
//
// Mid-pair detection (used to suppress idle-rotation of the displayed
// PIN while a user is typing it) is now `connected > authenticated`
// — i.e. at least one link is up but hasn't finished pairing yet.
static volatile uint8_t _ble_active_connections = 0;
static volatile uint8_t _ble_authenticated_connections = 0;

// Latched true when NimBLE asks us to display the passkey (i.e. the
// central is in the middle of pairing and waiting on the user). The
// main loop's display layer polls and consumes this so it can wake
// the OLED out of dim/off state and jump straight to the BLE PIN
// page — turning a "device is asleep, where's the PIN?" UX failure
// into a "screen lit up, here's the PIN" success.
static volatile bool _ble_pairing_request = false;
// Latched true when pairing finishes (success or failure). Lets the
// OLED briefly flash a "BONDED" or "PAIR FAIL" indicator instead of
// silently going back to whatever page we were on.
static volatile bool _ble_pairing_done = false;

// ── Pairing passkey ────────────────────────────────────────────────
// We use BLE_HS_IO_DISPLAY_ONLY pairing: the Heltec generates a 6-digit
// PIN, displays it on the OLED, and NimBLE returns it from
// onPassKeyDisplay() each time a central tries to pair. iOS pops its
// system "Bluetooth Pairing Request" dialog, the user reads the PIN
// from the OLED and enters it, and the bond is saved on both sides.
//
// The PIN is rotated under three triggers:
//   1. At boot.
//   2. Immediately after a successful pair (`onAuthenticationComplete`
//      with an encrypted link). Each new pair attempt therefore needs
//      a fresh PIN — a glanced PIN can't be reused later by a third
//      party. Existing bonds are not affected: NimBLE rotates the PIN
//      that's offered for *future* passkey-display pairings; existing
//      bonds use the stored LTK and don't need to re-exchange the PIN.
//   3. Every BLE_PASSKEY_MAX_AGE_MS of idle time (≈ 10 minutes by
//      default). Stops a long-displayed PIN from being usable hours
//      after someone glanced at it.
//
// Rotation is *suppressed* while a connection is up but not yet
// authenticated (`_ble_connected && !_ble_authenticated`) — that's the
// window where iOS has shown its passkey prompt and the user is
// reading + typing the digits, so changing the firmware-side value
// would invalidate whatever they typed.
//
// Range is 100000..999999 — always 6 digits so the OLED layout stays
// constant. esp_random() is hardware-RNG seeded at boot.
#ifndef BLE_PASSKEY_MAX_AGE_MS
#define BLE_PASSKEY_MAX_AGE_MS (10UL * 60UL * 1000UL)  // 10 minutes
#endif
static uint32_t _ble_passkey = 0;
static unsigned long _ble_passkey_generated_at = 0;

// Generate (or regenerate) the 6-digit pairing PIN and register it
// with NimBLE so future onPassKeyDisplay calls return the new value.
// `reason` is logged so a serial monitor can see why the rotation
// happened ("boot", "post-pair", "idle 10min", etc.).
static void _regenerateBlePasskey(const char* reason) {
    _ble_passkey = 100000 + (esp_random() % 900000);
    _ble_passkey_generated_at = millis();
    NimBLEDevice::setSecurityPasskey(_ble_passkey);
    Serial.printf("BLE: passkey rotated (%s) → %06u\n",
                  reason, (unsigned)_ble_passkey);
}

// Forward decls for the power profile. Defined in titanic_pwr.h;
// keeping the forwards here means BLE callbacks can manage the
// power mode without titanic_ble.h growing a hard dependency on
// titanic_pwr.h (the .ino includes both). Server builds
// short-circuit to no-ops internally so the calls are safe even
// when the profile is pinned.
void titanic_pwr_bump();
void titanic_pwr_holdBegin();
void titanic_pwr_holdEnd();

// ── Simple callbacks (no constructor args — avoids crash) ──
class _BLEServerCB : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
        if (_ble_active_connections < 0xFF) _ble_active_connections++;
        // A phone just paired (or hopped onto an existing bond) —
        // bump to HIGH so the link layer + LoRa stack are at max TX
        // for the operator's first few commands, AND latch the
        // power profile so we STAY at HIGH for the entire duration
        // of the BLE session (not just the first 60 s). The latch
        // is released in onDisconnect.
        titanic_pwr_bump();
        titanic_pwr_holdBegin();
        Serial.printf("BLE: central connected (handle %d, addr %s, total=%u)\n",
                      connInfo.getConnHandle(),
                      connInfo.getAddress().toString().c_str(),
                      (unsigned)_ble_active_connections);
        // NimBLE-Arduino auto-stops advertising once a central
        // connects (single-peripheral assumption baked into the
        // upstream code path). For a multi-connection controller
        // we want the next phone/iPad to be discoverable immediately,
        // so kick advertising back up explicitly while we still have
        // a free connection slot. NimBLE silently no-ops the
        // start-while-already-advertising case.
        if (_ble_active_connections < CONFIG_BT_NIMBLE_MAX_CONNECTIONS) {
            NimBLEDevice::startAdvertising();
            Serial.printf("BLE: re-armed advertising for next central (slots free=%u/%u)\n",
                          (unsigned)(CONFIG_BT_NIMBLE_MAX_CONNECTIONS - _ble_active_connections),
                          (unsigned)CONFIG_BT_NIMBLE_MAX_CONNECTIONS);
        } else {
            Serial.printf("BLE: at connection cap (%u), advertising paused\n",
                          (unsigned)CONFIG_BT_NIMBLE_MAX_CONNECTIONS);
        }
    }
    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
        if (_ble_active_connections > 0) _ble_active_connections--;
        // Drop the BLE-held latch so the normal fast→slow timeout
        // resumes from NOW. titanic_pwr_holdEnd() refreshes
        // _lastBumpMs internally, so the box runs at HIGH for one
        // more PWR_FAST_IDLE_MS window (covering reconnect attempts
        // and any in-flight LoRa retries) and then settles to LOW.
        titanic_pwr_holdEnd();
        // We track authenticated connections per-event by listening
        // for onAuthenticationComplete. NimBLE doesn't tell us in
        // onDisconnect whether the just-dropped link had pairing
        // done, so we conservatively decrement only if there were
        // any authenticated links to begin with — drift is corrected
        // on the next successful pair.
        if (_ble_authenticated_connections > _ble_active_connections) {
            _ble_authenticated_connections = _ble_active_connections;
        }
        // Reason codes worth knowing (HCI status, see BT Core spec):
        //   0x13 (19) = remote user terminated connection (normal)
        //   0x16 (22) = connection terminated by local host
        //   0x08 (8)  = supervision timeout (out of range / iPhone slept)
        //   0x3D (61) = connection failed to establish / encryption fail
        //   0x05 (5)  = authentication failure (wrong LTK / stale bond)
        // 0x05 / 0x3D after a connect attempt usually means iOS still
        // has a stale bond for a Heltec that has lost the matching LTK
        // (e.g. the controller was reflashed). The fix is "Forget This
        // Device" in iOS Settings → Bluetooth, then re-pair.
        Serial.printf("BLE: central disconnected (handle=%d, reason=%d, remaining=%u)\n",
                      connInfo.getConnHandle(), reason,
                      (unsigned)_ble_active_connections);
        // Always restart advertising on disconnect so the slot is
        // reusable. Idempotent on NimBLE; safe even if we're still
        // advertising.
        NimBLEDevice::startAdvertising();
    }

    // Pairing: NimBLE asks us which passkey to display. We return our
    // static-per-boot PIN so the OLED and the protocol agree, and we
    // raise the pairing-request flag so the display layer can wake the
    // OLED and force the BLE PIN page to be visible immediately —
    // critical UX, because if the screen is dim or off the user has no
    // way to read the PIN that iOS is prompting them for.
    uint32_t onPassKeyDisplay() override {
        Serial.printf("BLE: pairing initiated, displaying passkey %06u\n",
                      (unsigned)_ble_passkey);
        _ble_pairing_request = true;
        return _ble_passkey;
    }

    // Pairing finished — either successfully (encrypted link, bond stored)
    // or with a wrong-PIN failure. We refuse plaintext access by hanging
    // up if encryption didn't actually take effect; this matches the
    // NimBLE_Server example and prevents the "central paired but the
    // link is still plaintext" footgun on misconfigured stacks.
    void onAuthenticationComplete(NimBLEConnInfo& connInfo) override {
        _ble_pairing_done = true;
        if (!connInfo.isEncrypted()) {
            // Most common cause: the central (iOS) thought it had a
            // valid bond and tried the encrypt-only fast-path with
            // a stored LTK that the controller no longer has (eg.
            // post-reflash). NimBLE answers SMP_PAIR_FAIL and the
            // link comes back unencrypted. Forcing a disconnect here
            // makes iOS surface a "Bluetooth Pairing Request" prompt
            // on the next reconnect, which gets us back to a clean
            // pair flow.
            Serial.printf("BLE: pairing FAILED (link not encrypted, addr=%s) — disconnecting; user should 'Forget This Device' on the phone if this repeats\n",
                          connInfo.getAddress().toString().c_str());
            NimBLEDevice::getServer()->disconnect(connInfo.getConnHandle());
            return;
        }
        if (_ble_authenticated_connections < 0xFF) _ble_authenticated_connections++;
        Serial.printf("BLE: pairing OK, bonded to %s (encrypted=%d, auth=%d, total_auth=%u)\n",
                      connInfo.getAddress().toString().c_str(),
                      (int)connInfo.isEncrypted(),
                      (int)connInfo.isAuthenticated(),
                      (unsigned)_ble_authenticated_connections);
        // Burn the PIN we just used. Future pair attempts (e.g. a
        // second iPhone trying to bond) get a fresh number — a
        // glanced PIN is one-shot. The existing bond uses its
        // stored LTK, so this rotation is invisible to the device
        // we just paired with.
        _regenerateBlePasskey("post-pair");
    }
};

class _BLECmdCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
        // Belt-and-braces: the WRITE_ENC permission already blocks
        // unencrypted writes at the GATT layer, but if NimBLE ever
        // changes its enforcement order we'd silently accept commands
        // from an unauthenticated peer. Reject explicitly here too.
        if (!connInfo.isEncrypted()) {
            Serial.printf("BLE: rejecting write on unencrypted link\n");
            return;
        }
        String cmd = pChar->getValue().c_str();
        cmd.trim();
        if (cmd.length() > 0 && cmd.length() <= 250) {
            // Push into the ring queue. Check for full first — if so,
            // drop the new write rather than overwriting an unprocessed
            // one. The main loop has been the bottleneck for queue
            // overflow on this link (slow LoRa drain rate); dropping
            // the latest is preferable to losing the in-flight command
            // an operator is actively waiting on.
            uint8_t next_tail = (uint8_t)((_ble_cmd_q_tail + 1) % BLE_CMD_QUEUE_CAPACITY);
            if (next_tail == _ble_cmd_q_head) {
                _ble_cmd_q_dropped++;
                Serial.printf("BLE_CMD_DROP: queue full (cap=%d dropped=%u) cmd=%s\n",
                              BLE_CMD_QUEUE_CAPACITY,
                              (unsigned)_ble_cmd_q_dropped,
                              cmd.c_str());
                return;
            }
            _ble_cmd_queue[_ble_cmd_q_tail] = cmd;
            _ble_cmd_q_tail = next_tail;
            Serial.printf("BLE_CMD: %s\n", cmd.c_str());
            // Real command came in over BLE — bump to HIGH so the
            // outbound LoRa relay goes out at max TX. This is the
            // most-important wake trigger because a command on the
            // wire is exactly when latency matters most.
            titanic_pwr_bump();
        }
    }
};


class TitanicBLE {
public:
    int txCount = 0;
    int rxCount = 0;
    float lastRssi = 0;
    float lastSnr = 0;

    // True if at least one central is currently connected. Multi-link
    // booleans collapse to "any" — fine for the OLED's binary BLE LED.
    bool isConnected() { return _ble_active_connections > 0; }
    // True if at least one connected central completed pairing and is
    // running encrypted. Used by the OLED to switch the BLE icon from
    // "linked but unauthenticated" → "fully bonded".
    bool isAuthenticated() { return _ble_authenticated_connections > 0; }
    // Exposed counts for finer-grained UI ("2 phones bonded") and
    // for diagnostic prints from the main loop / serial console.
    uint8_t connectedCount() { return _ble_active_connections; }
    uint8_t authenticatedCount() { return _ble_authenticated_connections; }

    // The static-per-boot passkey is exposed so the OLED can render it.
    // Both forms returned: numeric for any computation, zero-padded
    // 6-digit string for display (the leading zero on e.g. 042193
    // matters — iOS's pairing dialog also expects 6 digits).
    uint32_t getPasskey() { return _ble_passkey; }
    String   getPasskeyStr() {
        char buf[8];
        snprintf(buf, sizeof(buf), "%06u", (unsigned)_ble_passkey);
        return String(buf);
    }

    // The exact name we put on the air. Lets the OLED header and any
    // diagnostic Serial output show what scanners actually see, instead
    // of guessing from DEVICE_SHORT/NODE_ID.
    String getBleName() const { return _bleName; }

    // Pairing-event flags (read-and-clear). The display layer polls
    // these so it can wake the screen at exactly the right moment
    // without us having to plumb a callback into titanic_common.h.
    //
    // - Pairing request: iOS just popped its "enter PIN" prompt; we
    //   want the OLED awake and on the PIN page NOW.
    // - Pairing done: bond completed (or failed); the display can stop
    //   forcing the PIN page and go back to its normal cycle.
    bool consumePairingRequest() {
        bool v = _ble_pairing_request;
        _ble_pairing_request = false;
        return v;
    }
    bool consumePairingDone() {
        bool v = _ble_pairing_done;
        _ble_pairing_done = false;
        return v;
    }

    // ── Command queue (phone writes → main loop reads) ────
    bool hasCommand() { return _ble_cmd_q_head != _ble_cmd_q_tail; }
    String popCommand() {
        if (_ble_cmd_q_head == _ble_cmd_q_tail) return String("");
        String cmd = _ble_cmd_queue[_ble_cmd_q_head];
        _ble_cmd_queue[_ble_cmd_q_head] = String("");  // free the heap chunk
        _ble_cmd_q_head = (uint8_t)((_ble_cmd_q_head + 1) % BLE_CMD_QUEUE_CAPACITY);
        return cmd;
    }
    uint16_t cmdQueueDroppedCount() const { return _ble_cmd_q_dropped; }

    void begin(const char* shortName, const char* role,
               float freq, int sf, float bw, int txPower) {
        _role = role;

        // Advertised name. Two-part scheme:
        //   1. fixed prefix "tcon_" (Titanic CONtroller, all lowercase
        //      to match the .config.nodes.yaml naming convention) — the
        //      iPhone scan filter looks for this prefix, but the OS-
        //      level filter is by service UUID so the prefix is mostly
        //      cosmetic.
        //   2. per-node short name from BLE_NODE_NAME (defaults to
        //      "node" if deploy.py wasn't used to flash; deploy.py
        //      sources this from `name:` in .config.nodes.yaml).
        // Examples: tcon_captain, tcon_server, tcon_crew_01.
        //
        // We deliberately ignore the `shortName` arg (it's still
        // accepted to keep begin()'s signature backwards-compatible
        // for any caller mid-migration).
        (void)shortName;
        _bleName = String("tcon_") + String(BLE_NODE_NAME);
        NimBLEDevice::init(_bleName.c_str());
        // BLE TX power is now managed by the power profile (see
        // titanic_pwr_setup() in main.cpp, runs right after this
        // function returns). We set a conservative initial value
        // here so any BLE chatter between init and the profile
        // taking over is on-air, then the profile bumps to HIGH
        // before the first connection callback fires.
        NimBLEDevice::setPower(ESP_PWR_LVL_P3);

        // ── BLE security: passkey-display pairing ──────────────────
        // Order matters: configure security BEFORE creating services
        // so the per-characteristic ENC/AUTHEN permissions know what
        // pairing scheme to enforce.
        //   IO cap = DISPLAY_ONLY      → peripheral shows PIN, central
        //                                  prompts user to enter it.
        //   bond + mitm + sc           → store LTK on both sides (so
        //                                  re-pairing isn't required on
        //                                  every reconnect), require
        //                                  Man-In-The-Middle protection
        //                                  via the passkey, and use the
        //                                  modern Secure-Connections
        //                                  pairing (ECDH key agreement,
        //                                  not legacy random).
        NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
        NimBLEDevice::setSecurityAuth(true, true, true);
        // Initial PIN. Subsequent rotations happen in update() (idle
        // timer) and onAuthenticationComplete (post-pair).
        _regenerateBlePasskey("boot");

        NimBLEServer* pServer = NimBLEDevice::createServer();
        pServer->setCallbacks(new _BLEServerCB());

        NimBLEService* pService = pServer->createService(TITANIC_SERVICE_UUID);

        // ── Static characteristics (read-only) ──
        pService->createCharacteristic(CHAR_ROLE_UUID, NIMBLE_PROPERTY::READ)
            ->setValue(role);
        pService->createCharacteristic(CHAR_FW_VER_UUID, NIMBLE_PROPERTY::READ)
            ->setValue(FW_VERSION);
        pService->createCharacteristic(CHAR_FREQ_UUID, NIMBLE_PROPERTY::READ)
            ->setValue(String(freq, 1).c_str());
        pService->createCharacteristic(CHAR_SF_UUID, NIMBLE_PROPERTY::READ)
            ->setValue(String(sf).c_str());
        pService->createCharacteristic(CHAR_BW_UUID, NIMBLE_PROPERTY::READ)
            ->setValue(String(bw, 0).c_str());
        pService->createCharacteristic(CHAR_TXPOW_UUID, NIMBLE_PROPERTY::READ)
            ->setValue(String(txPower).c_str());

        // ── Dynamic characteristics (read + notify) ──
        // Telemetry chars (uptime/counts/rssi/snr) stay unencrypted on
        // purpose: a stranger walking by with nRF Connect should be
        // able to confirm "this Heltec is alive and on the right
        // frequency" without going through pairing. They're public
        // diagnostic data and contain no secrets.
        _charUptime = pService->createCharacteristic(CHAR_UPTIME_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
        _charTxCount = pService->createCharacteristic(CHAR_TX_COUNT_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
        _charRxCount = pService->createCharacteristic(CHAR_RX_COUNT_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
        _charLastRssi = pService->createCharacteristic(CHAR_LAST_RSSI_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
        _charLastSnr = pService->createCharacteristic(CHAR_LAST_SNR_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

        // CHAR_LAST_RX carries the most-recent LoRa RX payload — that
        // payload is itself AES-128-GCM encrypted at the Titanic Frame
        // v2 layer, so reading it without the shared key reveals
        // nothing useful. Even so, we gate it on an ENCRYPTED BLE link
        // so that an unauthenticated peer can't piggy-back on the
        // notification stream to fingerprint traffic timing or counts.
        // It also doubles as the "trigger pairing right after connect"
        // hook the iPhone uses (any READ on this char from an unpaired
        // central will cause iOS to pop its pairing dialog).
        _charLastRx = pService->createCharacteristic(CHAR_LAST_RX_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC |
            NIMBLE_PROPERTY::NOTIFY);

        _charUptime->setValue("0");
        _charTxCount->setValue("0");
        _charRxCount->setValue("0");
        _charLastRssi->setValue("0");
        _charLastSnr->setValue("0");
        _charLastRx->setValue("");

        // ── Command characteristic (write from phone) ──
        // CHAR_CMD writes trigger a real LoRa transmission, so we must
        // refuse them from any peer that hasn't completed pairing.
        // WRITE_ENC = the link must be encrypted; combined with the
        // BLE_HS_IO_DISPLAY_ONLY + MITM + Secure-Connections settings
        // above, this means a successful pairing with the displayed
        // PIN is required before any command flows.
        NimBLECharacteristic* pCmd = pService->createCharacteristic(CHAR_CMD_UUID,
            NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR |
            NIMBLE_PROPERTY::WRITE_ENC);
        pCmd->setCallbacks(new _BLECmdCB());
        pCmd->setValue("");

        pService->start();

        // Start advertising with device name visible in scans.
        //
        // Background: BLE primary advertising packets are hard-capped
        // at 31 bytes (Bluetooth Core spec). A 128-bit service UUID AD
        // consumes 18 bytes (1 type + 1 length + 16 UUID) plus 3 bytes
        // of mandatory flags, leaving only ~10 bytes for any extra
        // field. A name like "TCon-Podium" (11 chars + 2 byte AD
        // overhead = 13 bytes) overflows that budget, so NimBLE drops
        // it from the primary ADV.
        //
        // Naive `setName()` + `enableScanResponse(true)` is documented
        // to auto-overflow into the scan response, but in practice
        // NimBLE 2.x leaves the scan response packet EMPTY unless we
        // construct one explicitly. We verified this with bleak in
        // detection-callback mode (35 packets observed across 12 s,
        // zero with a local_name field). The fix is to build a real
        // NimBLEAdvertisementData for the scan response and put the
        // name there ourselves.
        //
        // Resulting packet layout:
        //   primary ADV    : Flags + CompleteServices128(TITANIC) + TX power
        //   scan response  : CompleteName("tcon_<node>")
        // iOS active-scans by default and merges both into a single
        // discovery callback, so the iPhone sees the name normally.
        NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
        pAdv->addServiceUUID(TITANIC_SERVICE_UUID);
        pAdv->setName(_bleName.c_str());

        // Explicit scan response with the full local name. This is the
        // missing piece that makes the name visible to iOS / nRF
        // Connect / bleak. setScanResponseData() implicitly enables
        // the scan response packet, so we don't need a separate
        // enableScanResponse(true) call.
        NimBLEAdvertisementData scanResp;
        scanResp.setName(_bleName.c_str());
        pAdv->setScanResponseData(scanResp);
        pAdv->enableScanResponse(true);
        pAdv->start();

        Serial.printf("BLE: advertising as '%s' (svc=%s, scan_rsp=on)\n",
                      _bleName.c_str(), TITANIC_SERVICE_UUID);
        Serial.printf("BLE: pairing PIN = %06u  (also shown on OLED, page 4)\n",
                      (unsigned)_ble_passkey);
    }

    void update() {
        if (millis() - _lastUpdate < 2000) return;
        _lastUpdate = millis();

        _charUptime->setValue(String(millis() / 1000).c_str());
        _charTxCount->setValue(String(txCount).c_str());
        _charRxCount->setValue(String(rxCount).c_str());
        _charLastRssi->setValue(String(lastRssi, 1).c_str());
        _charLastSnr->setValue(String(lastSnr, 1).c_str());

        _charUptime->notify();
        _charTxCount->notify();
        _charRxCount->notify();

        // Idle PIN rotation. Skip while ANY central is mid-pair (iOS
        // has shown its passkey prompt and the user is reading the
        // digits; changing the firmware-side value now would invalidate
        // whatever they type). With multi-link, "mid-pair" means
        // there's at least one connection that hasn't completed
        // authentication yet — derived directly from the per-connection
        // counters maintained by the server callbacks.
        const bool midPair =
            _ble_active_connections > _ble_authenticated_connections;
        if (!midPair &&
            (millis() - _ble_passkey_generated_at) >= BLE_PASSKEY_MAX_AGE_MS) {
            _regenerateBlePasskey("idle 10min");
        }
    }

    void onPacket(float rssi, float snr) {
        rxCount++;
        lastRssi = rssi;
        lastSnr = snr;
    }

    void onPacketPayload(const String& payload) {
        if (_charLastRx) {
            _charLastRx->setValue(payload.c_str());
            _charLastRx->notify();
        }
    }

    void onTransmit() {
        txCount++;
    }

private:
    const char* _role;
    String _bleName;
    unsigned long _lastUpdate = 0;

    NimBLECharacteristic* _charUptime;
    NimBLECharacteristic* _charTxCount;
    NimBLECharacteristic* _charRxCount;
    NimBLECharacteristic* _charLastRssi;
    NimBLECharacteristic* _charLastSnr;
    NimBLECharacteristic* _charLastRx;
};

#endif // TITANIC_BLE_H
