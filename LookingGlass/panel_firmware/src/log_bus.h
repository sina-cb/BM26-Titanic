#pragma once
// log_bus.h — one logging primitive for the whole firmware.
//
// panel_log() prints a line to Serial AND enqueues it on a FreeRTOS queue so
// the core-0 web task can stream it to WebSocket clients. It is safe to call
// from either core (button events come from core 1, network logs from core 0);
// the queue is the cross-core hand-off. If the queue is full the line is still
// printed to Serial but dropped from the web stream — logging never blocks the
// button loop.
#include <Arduino.h>

void log_bus_init();                         // call once, early in setup()
void panel_log(const char *fmt, ...);        // printf-style; appends a newline on Serial
bool log_bus_pop(char *out, size_t out_len); // drain one line (web task); false if empty
