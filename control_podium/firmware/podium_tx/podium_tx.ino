/*
 * Podium TX — Raw LoRa Transmitter for Heltec V4
 * ================================================
 * Reads lines from USB serial, transmits them over LoRa.
 * Also listens for incoming LoRa packets (bidirectional).
 *
 * Uses: ropg/heltec_esp32_lora_v3 (RadioLib wrapper)
 * Board: Heltec WiFi LoRa 32(V3) — pin-compatible with V4
 *
 * Serial protocol:
 *   IN:  <text>\n                     → transmits over LoRa
 *   OUT: TX_OK                       → after successful transmit
 *   OUT: TX_FAIL:<code>              → on transmit error
 *   OUT: RX:<payload>:RSSI=<r>:SNR=<s>  → on received packet
 */

#include <heltec_unofficial.h>

// Radio parameters — must match server_rx.ino exactly
#define FREQUENCY   915.0   // MHz (US ISM)
#define BANDWIDTH   250.0   // kHz
#define SF          7       // Spreading Factor
#define CR          5       // Coding Rate 4/5
#define TX_POWER    22      // dBm (use 22 for safe start, can go to 28)

int txCount = 0;
int rxCount = 0;

void setup() {
    heltec_setup();

    both.println("Podium TX v1.0");
    both.println("Initializing radio...");

    RADIOLIB_OR_HALT(radio.begin(FREQUENCY, BANDWIDTH, SF, CR));
    RADIOLIB_OR_HALT(radio.setOutputPower(TX_POWER));

    display.clear();
    display.println("Podium TX READY");
    display.printf("%.0f MHz SF%d BW%.0f\n", FREQUENCY, SF, BANDWIDTH);
    display.printf("Power: %d dBm\n", TX_POWER);
    display.display();

    Serial.println("READY");
}

void loop() {
    heltec_loop();

    // --- Check for serial input (TX) ---
    if (Serial.available()) {
        String msg = Serial.readStringUntil('\n');
        msg.trim();
        if (msg.length() > 0 && msg.length() <= 250) {
            txCount++;

            // Transmit over LoRa
            int state = radio.transmit(msg);
            if (state == RADIOLIB_ERR_NONE) {
                Serial.println("TX_OK");
                heltec_led(50);

                display.clear();
                display.printf("TX #%d OK\n", txCount);
                display.println(msg.substring(0, 20));
                display.display();

                delay(30);
                heltec_led(0);
            } else {
                Serial.printf("TX_FAIL:%d\n", state);
                display.clear();
                display.printf("TX #%d FAIL %d\n", txCount, state);
                display.display();
            }

            // After TX, briefly listen for response
            radio.startReceive();
        }
    }

    // --- Check for incoming LoRa packets (RX) ---
    String payload;
    int state = radio.receive(payload, 0);  // non-blocking
    if (state == RADIOLIB_ERR_NONE && payload.length() > 0) {
        rxCount++;
        float rssi = radio.getRSSI();
        float snr  = radio.getSNR();

        Serial.printf("RX:%s:RSSI=%.1f:SNR=%.1f\n",
                       payload.c_str(), rssi, snr);
        heltec_led(50);

        display.clear();
        display.printf("RX #%d\n", rxCount);
        display.println(payload.substring(0, 20));
        display.printf("RSSI:%.0f SNR:%.1f\n", rssi, snr);
        display.display();

        delay(30);
        heltec_led(0);
    }
}
