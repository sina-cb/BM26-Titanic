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

#define FW_VERSION "1.3-ble-sync"

// ── Static command buffer (shared between callback and main loop) ──
static volatile bool _ble_pending_cmd = false;
static String _ble_cmd_buffer = "";
static bool _ble_connected = false;

// ── Simple callbacks (no constructor args — avoids crash) ──
class _BLEServerCB : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) {
        _ble_connected = true;
        Serial.printf("BLE: Control Center connected (handle %d)\n", connInfo.getConnHandle());
    }
    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) {
        _ble_connected = false;
        Serial.printf("BLE: Control Center disconnected (reason %d)\n", reason);
        NimBLEDevice::startAdvertising();
    }
};

class _BLECmdCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) {
        String cmd = pChar->getValue().c_str();
        cmd.trim();
        if (cmd.length() > 0 && cmd.length() <= 250) {
            _ble_cmd_buffer = cmd;
            _ble_pending_cmd = true;
            Serial.printf("BLE_CMD: %s\n", cmd.c_str());
        }
    }
};


class TitanicBLE {
public:
    int txCount = 0;
    int rxCount = 0;
    float lastRssi = 0;
    float lastSnr = 0;

    bool isConnected() { return _ble_connected; }

    // ── Command queue (phone writes → main loop reads) ────
    bool hasCommand() { return _ble_pending_cmd; }
    String popCommand() {
        _ble_pending_cmd = false;
        String cmd = _ble_cmd_buffer;
        _ble_cmd_buffer = "";
        return cmd;
    }

    void begin(const char* shortName, const char* role,
               float freq, int sf, float bw, int txPower) {
        _role = role;

        String bleName = String("Ttnc-") + shortName;
        NimBLEDevice::init(bleName.c_str());
        NimBLEDevice::setPower(ESP_PWR_LVL_P3);

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
        _charLastRx = pService->createCharacteristic(CHAR_LAST_RX_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

        _charUptime->setValue("0");
        _charTxCount->setValue("0");
        _charRxCount->setValue("0");
        _charLastRssi->setValue("0");
        _charLastSnr->setValue("0");
        _charLastRx->setValue("");

        // ── Command characteristic (write from phone) ──
        NimBLECharacteristic* pCmd = pService->createCharacteristic(CHAR_CMD_UUID,
            NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
        pCmd->setCallbacks(new _BLECmdCB());
        pCmd->setValue("");

        pService->start();

        // Start advertising with device name visible in scans
        NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
        pAdv->addServiceUUID(TITANIC_SERVICE_UUID);
        pAdv->setName(bleName.c_str());
        pAdv->start();

        Serial.printf("BLE: advertising as '%s'\n", bleName.c_str());
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
    unsigned long _lastUpdate = 0;

    NimBLECharacteristic* _charUptime;
    NimBLECharacteristic* _charTxCount;
    NimBLECharacteristic* _charRxCount;
    NimBLECharacteristic* _charLastRssi;
    NimBLECharacteristic* _charLastSnr;
    NimBLECharacteristic* _charLastRx;
};

#endif // TITANIC_BLE_H
