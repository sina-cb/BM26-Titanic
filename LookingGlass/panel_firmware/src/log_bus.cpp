#include "log_bus.h"
#include <stdarg.h>

// Fixed-size lines keep the queue allocation-free and bounded.
static const size_t LOG_LINE_LEN = 160;
static const int    LOG_QUEUE_LEN = 32;

struct LogLine {
    char s[LOG_LINE_LEN];
};

static QueueHandle_t g_queue = nullptr;

void log_bus_init() {
    if (!g_queue) {
        g_queue = xQueueCreate(LOG_QUEUE_LEN, sizeof(LogLine));
    }
}

void panel_log(const char *fmt, ...) {
    LogLine line;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(line.s, sizeof(line.s), fmt, ap);
    va_end(ap);

    Serial.println(line.s);

    // Non-blocking: never stall the caller (could be the button core). If the
    // web task is behind and the queue is full, drop the oldest to make room
    // so the live view keeps showing the most recent lines.
    if (g_queue) {
        if (xQueueSend(g_queue, &line, 0) != pdTRUE) {
            LogLine discard;
            xQueueReceive(g_queue, &discard, 0);
            xQueueSend(g_queue, &line, 0);
        }
    }
}

bool log_bus_pop(char *out, size_t out_len) {
    if (!g_queue || out_len == 0) return false;
    LogLine line;
    if (xQueueReceive(g_queue, &line, 0) == pdTRUE) {
        strncpy(out, line.s, out_len);
        out[out_len - 1] = '\0';
        return true;
    }
    return false;
}
