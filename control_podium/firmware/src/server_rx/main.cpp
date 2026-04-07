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

// Shared TX logic — works for both serial and BLE commands
void transmitMessage(String msg) {
    ble.onTransmit();
    int state = radio.transmit(msg);
    if (state == RADIOLIB_ERR_NONE) {
        Serial.println("TX_OK");
        heltec_led(50);
        titanicShowTX(ble.txCount, msg, true);
        delay(30);
        heltec_led(0);
    } else {
        Serial.printf("TX_FAIL:%d\n", state);
        titanicShowTX(ble.txCount, msg, false, state);
    }
    // Return to receive mode
    radio.startReceive();
}

void loop() {
    heltec_loop();
    ble.update();
    titanicDisplayUpdate();

    // --- RX: incoming LoRa packets (primary function) ---
    String payload;
    int state = radio.receive(payload, 0);
    if (state == RADIOLIB_ERR_NONE && payload.length() > 0) {
        float rssi = radio.getRSSI();
        float snr  = radio.getSNR();
        ble.onPacket(rssi, snr);
        ble.onPacketPayload(payload);

        Serial.printf("RX:%s:RSSI=%.1f:SNR=%.1f\n",
                       payload.c_str(), rssi, snr);
        heltec_led(50);
        titanicShowRX(ble.rxCount, payload, rssi, snr);
        delay(30);
        heltec_led(0);
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
