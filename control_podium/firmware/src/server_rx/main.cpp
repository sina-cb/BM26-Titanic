/*
 * Server RX — Thin main layer
 * =============================
 * Listens for incoming LoRa packets. Can also TX via serial/BLE.
 * All shared code lives in titanic_common.h and titanic_ble.h.
 */

#define DEVICE_ROLE  "SERVER_RX"
#define DEVICE_SHORT "Server"

#include "titanic_common.h"

// Non-blocking serial buffer
static String serialBuf = "";

void setup() {
    titanicSetup();
    Serial.setTimeout(10);  // Fast serial processing (default was 1000ms!)

    // Start in receive mode
    radio.startReceive();

    titanicShowReady();
    Serial.println("READY");
}

// Forward decl so transmitMessage() can transmit relayed *CFG too.
static void _transmitRaw(String msg);

// Shared TX logic — works for both serial and BLE commands.
// Non-blocking LED flash is critical here: every ms we spend between
// transmit() returning and startReceive() being called is a ms the peer's
// reply can fly past us. See titanic_common.h::titanicLedFlash() comment.
void transmitMessage(String msg) {
    // Intercept profile-switch lines BEFORE TX. The bridge (or BLE
    // operator) writes a "*CFG name=… t=…" line and expects:
    //   1) this controller schedules the apply locally
    //   2) the same line is RELAYED over LoRa so the peer (captain)
    //      hears it on the OLD profile and switches in lockstep
    // If we just TX the *CFG verbatim without (1), the server would
    // change peer-side but stay on its own old profile.
    String relay_payload;
    if (titanic_profile_handle_cfg_line(
            msg.c_str(), /*originated_locally=*/true, &relay_payload)) {
        Serial.printf("CFG_LOCAL_OK msg=%s\n", msg.c_str());
        if (relay_payload.length() > 0) {
            // Re-send a few copies over the OLD profile so the
            // captain has multiple chances to hear before applying.
            // 3 copies spaced ~700 ms apart fits inside the typical
            // 4 s delay window used by the bridge.
            for (int i = 0; i < 3; ++i) {
                _transmitRaw(relay_payload);
                if (i < 2) delay(700);
            }
        }
        return;
    }

    _transmitRaw(msg);
}

// Redundant-transmit count for v2 frames. Set to 1 = single TX.
// See podium_tx/main.cpp for the measurement rationale — higher
// counts made round-trip reliability worse on this rig because
// the sender went deaf to peer frames during its own TX burst.
#ifndef LORA_REDUNDANT_TX_COUNT
#define LORA_REDUNDANT_TX_COUNT 1
#endif
#ifndef LORA_REDUNDANT_TX_GAP_MS
#define LORA_REDUNDANT_TX_GAP_MS 60
#endif

static void _transmitRaw(String msg) {
    ble.onTransmit();
    const bool is_secured = msg.startsWith("T2|");
    const int copies = is_secured ? LORA_REDUNDANT_TX_COUNT : 1;
    int last_state = RADIOLIB_ERR_NONE;
    for (int i = 0; i < copies; ++i) {
        if (i > 0) delay(LORA_REDUNDANT_TX_GAP_MS);
        last_state = radio.transmit(msg);
        if (last_state != RADIOLIB_ERR_NONE) break;
    }
    if (last_state == RADIOLIB_ERR_NONE) {
        Serial.printf("TX_OK%s\n", copies > 1 ? "_RDX" : "");
        titanicLedFlash(50, 30);
        titanicShowTX(ble.txCount, msg, true);
    } else {
        Serial.printf("TX_FAIL:%d\n", last_state);
        titanicShowTX(ble.txCount, msg, false, last_state);
    }
    // Return to receive mode (now runs immediately).
    radio.startReceive();
}

void loop() {
    heltec_loop();
    ble.update();
    titanicDisplayUpdate();
    // Per-loop tick for the runtime profile scheduler. Applies any
    // pending profile-switch once its deadline arrives. Costs ~1 µs
    // when there's nothing pending.
    titanic_profile_loop();

    // --- RX: non-blocking IRQ poll (primary function) ---
    // CRITICAL: do NOT use radio.receive(payload, 0) here. That call is
    // BLOCKING (up to ~1.83s for max packet size at our SF/BW) and the
    // first thing it does is set the radio to standby — which destroys
    // the continuous-receive state and means we miss any packet that
    // arrives during the call. With the IRQ poll below the loop runs at
    // full speed (~kHz) and we never miss a packet that landed in the
    // SX1262 FIFO between iterations.
    if (radio.getIrqFlags() & RADIOLIB_SX126X_IRQ_RX_DONE) {
        String payload;
        int state = radio.readData(payload, 0);
        radio.clearIrqFlags(RADIOLIB_SX126X_IRQ_RX_DONE);
        if (state == RADIOLIB_ERR_NONE && payload.length() > 0) {
            float rssi = radio.getRSSI();
            float snr  = radio.getSNR();

            // Intercept relayed profile-switch frames BEFORE the
            // normal serial-forward path so the bridge doesn't see
            // them as garbage RX lines (the *CFG prefix is plaintext;
            // legit v2 frames begin with "T2|" so there's no overlap).
            if (titanic_profile_handle_cfg_line(
                    payload.c_str(), /*originated_locally=*/false, nullptr)) {
                Serial.printf("CFG_PEER rssi=%.1f snr=%.1f msg=%s\n",
                              rssi, snr, payload.c_str());
                titanicLedFlash(50, 30);
            } else {
                ble.onPacket(rssi, snr);
                ble.onPacketPayload(payload);
                Serial.printf("RX:%s:RSSI=%.1f:SNR=%.1f\n",
                               payload.c_str(), rssi, snr);
                titanicLedFlash(50, 30);
                titanicShowRX(ble.rxCount, payload, rssi, snr);
            }
        }
    }

    // --- TX from serial: non-blocking character-by-character read ---
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n' || c == '\r') {
            serialBuf.trim();
            if (serialBuf.length() > 0 && serialBuf.length() <= 250) {
                transmitMessage(serialBuf);
            }
            serialBuf = "";
        } else {
            serialBuf += c;
        }
    }

    // --- TX from BLE: phone sent a command ---
    if (ble.hasCommand()) {
        String cmd = ble.popCommand();
        Serial.printf("BLE_TX: %s\n", cmd.c_str());
        transmitMessage(cmd);
    }
}
