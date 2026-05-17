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

// Shared TX logic — works for both serial and BLE commands.
// Non-blocking LED flash is critical here: every ms we spend between
// transmit() returning and startReceive() being called is a ms the peer's
// reply can fly past us. See titanic_common.h::titanicLedFlash() comment.
void transmitMessage(String msg) {
    ble.onTransmit();
    int state = radio.transmit(msg);
    if (state == RADIOLIB_ERR_NONE) {
        Serial.println("TX_OK");
        titanicLedFlash(50, 30);
        titanicShowTX(ble.txCount, msg, true);
    } else {
        Serial.printf("TX_FAIL:%d\n", state);
        titanicShowTX(ble.txCount, msg, false, state);
    }
    // Return to receive mode (now runs immediately).
    radio.startReceive();
}

void loop() {
    heltec_loop();
    ble.update();
    titanicDisplayUpdate();

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
            ble.onPacket(rssi, snr);
            ble.onPacketPayload(payload);

            Serial.printf("RX:%s:RSSI=%.1f:SNR=%.1f\n",
                           payload.c_str(), rssi, snr);
            titanicLedFlash(50, 30);
            titanicShowRX(ble.rxCount, payload, rssi, snr);
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
