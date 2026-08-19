/*
 * Custom pins_arduino.h for PlatformIO + ropg/heltec_esp32_lora_v3
 * ==================================================================
 * The ropg library's heltec_unofficial.h defines pin names as:
 *   #define SS GPIO_NUM_8
 *   #define MOSI GPIO_NUM_10
 *   etc.
 *
 * The stock PlatformIO Heltec V3 variant defines them as:
 *   static const uint8_t SS = 8;
 *   static const uint8_t MOSI = 10;
 *   etc.
 *
 * These conflict: you can't #define a token that's already a variable.
 *
 * This custom variant defines ONLY the pins that the ropg library
 * does NOT define. The ropg library's heltec_unofficial.h provides:
 *   SS, MOSI, MISO, SCK, DIO1, RST_LoRa, BUSY_LoRa,
 *   SDA_OLED, SCL_OLED, RST_OLED
 *
 * Everything else (TX, RX, SDA, SCL, Analog, Touch, LED, Vext)
 * is defined here.
 */

#ifndef Pins_Arduino_h
#define Pins_Arduino_h

#include <stdint.h>
#include "soc/soc_caps.h"

#define WIFI_LoRa_32_V3 true
#define DISPLAY_HEIGHT 64
#define DISPLAY_WIDTH  128

#define USB_VID 0x303a
#define USB_PID 0x1001

#define EXTERNAL_NUM_INTERRUPTS 46
#define NUM_DIGITAL_PINS        48
#define NUM_ANALOG_INPUTS       20

static const uint8_t LED_BUILTIN = SOC_GPIO_PIN_COUNT + 48;
#define BUILTIN_LED  LED_BUILTIN
#define LED_BUILTIN  LED_BUILTIN
#define RGB_BUILTIN  LED_BUILTIN
#define RGB_BRIGHTNESS 64

#define analogInputToDigitalPin(p)  (((p)<20)?(analogChannelToDigitalPin(p)):-1)
#define digitalPinToInterrupt(p)    (((p)<49)?(p):-1)
#define digitalPinHasPWM(p)         (p < 46)

static const uint8_t TX = 43;
static const uint8_t RX = 44;

static const uint8_t SDA = 41;
static const uint8_t SCL = 42;

/* ── SPI pins ─────────────────────────────────────────────
 * Defined as macros (not static const) so they don't conflict
 * with heltec_unofficial.h's own #define SS GPIO_NUM_8, etc.
 * The values are identical — just the declaration style differs.
 */
#ifndef SS
#define SS   8
#endif
#ifndef MOSI
#define MOSI 10
#endif
#ifndef MISO
#define MISO 11
#endif
#ifndef SCK
#define SCK  9
#endif

/* ── OLED pins ────────────────────────────────────────────
 * Same approach: macros with #ifndef guards.
 */
#ifndef SDA_OLED
#define SDA_OLED 17
#endif
#ifndef SCL_OLED
#define SCL_OLED 18
#endif
#ifndef RST_OLED
#define RST_OLED 21
#endif

/* ── LoRa pins ────────────────────────────────────────────*/
#ifndef RST_LoRa
#define RST_LoRa  12
#endif
#ifndef BUSY_LoRa
#define BUSY_LoRa 13
#endif
#ifndef DIO0
#define DIO0 14
#endif
#ifndef DIO1
#define DIO1 14
#endif

/* ── Analog pins ──────────────────────────────────────────*/
static const uint8_t A0 = 1;
static const uint8_t A1 = 2;
static const uint8_t A2 = 3;
static const uint8_t A3 = 4;
static const uint8_t A4 = 5;
static const uint8_t A5 = 6;
static const uint8_t A6 = 7;
static const uint8_t A7 = 8;
static const uint8_t A8 = 9;
static const uint8_t A9 = 10;
static const uint8_t A10 = 11;
static const uint8_t A11 = 12;
static const uint8_t A12 = 13;
static const uint8_t A13 = 14;
static const uint8_t A14 = 15;
static const uint8_t A15 = 16;
static const uint8_t A16 = 17;
static const uint8_t A17 = 18;
static const uint8_t A18 = 19;
static const uint8_t A19 = 20;

/* ── Touch pins ───────────────────────────────────────────*/
static const uint8_t T1 = 1;
static const uint8_t T2 = 2;
static const uint8_t T3 = 3;
static const uint8_t T4 = 4;
static const uint8_t T5 = 5;
static const uint8_t T6 = 6;
static const uint8_t T7 = 7;
static const uint8_t T8 = 8;
static const uint8_t T9 = 9;
static const uint8_t T10 = 10;
static const uint8_t T11 = 11;
static const uint8_t T12 = 12;
static const uint8_t T13 = 13;
static const uint8_t T14 = 14;

/* ── Other board pins ─────────────────────────────────────*/
static const uint8_t Vext = 36;
static const uint8_t LED  = 35;

#endif /* Pins_Arduino_h */
