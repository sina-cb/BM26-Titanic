#include "net_portal.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <WebSocketsServer.h>

#include "config.h"
#include "button.h"
#include "telemetry.h"
#include "log_bus.h"
#include "generated/net_config.h"   // baked from config.yaml + env-provided secrets

// Button name/GPIO tables, built straight from BUTTON_TABLE so the portal
// stays in sync with config.h with zero duplication.
static const char *const kBtnNames[BUTTON_COUNT] = {
#define X(id, gpio) #id,
    BUTTON_TABLE(X)
#undef X
};
static const uint8_t kBtnGpios[BUTTON_COUNT] = {
#define X(id, gpio) gpio,
    BUTTON_TABLE(X)
#undef X
};

static WebServer        g_server(CFG_WEB_PORT);
static DNSServer        g_dns;
static WebSocketsServer g_ws(81);          // live logs + stats push
static const uint16_t   kDnsPort = 53;

// AP facts resolved at startup (channel may be moved to match the station).
static int  g_ap_channel = CFG_AP_CHANNEL;
static bool g_ap_secure  = (sizeof(CFG_AP_PASSWORD) > 1);

// Recent log history (core-0 only) so a freshly-connected WebSocket client
// sees the last few lines instead of a blank panel.
static const int LOG_HIST_MAX = 24;
static String    g_log_hist[LOG_HIST_MAX];
static int       g_log_hist_count = 0;     // valid entries (<= MAX)
static int       g_log_hist_head  = 0;     // next write slot (ring)

// ---- page rendering ------------------------------------------
static String render_html() {
    const Telemetry t  = telemetry_snapshot();
    const uint32_t up  = millis() / 1000;
    const bool sta_up  = (WiFi.status() == WL_CONNECTED);

    String h;
    h.reserve(6400);
    h += F("<!doctype html><html><head><meta charset='utf-8'>"
           "<meta name='viewport' content='width=device-width,initial-scale=1'>"
           "<title>LookingGlass Panel</title><style>"
           "body{font-family:system-ui,Segoe UI,sans-serif;background:#0b0f14;color:#cdd6e4;margin:0;padding:16px}"
           "h1{font-size:18px;margin:0 0 2px}.sub{color:#7d8aa0;font-size:12px;margin-bottom:14px}"
           ".card{background:#0f1620;border:1px solid #1e2a38;border-radius:8px;padding:10px 12px;margin-bottom:12px}"
           ".card b{color:#8fb7e0;font-size:13px}"
           "table{border-collapse:collapse;width:100%;margin-top:6px}"
           "td,th{border:1px solid #1e2a38;padding:5px 8px;text-align:left;font-size:13px}"
           "th{background:#11202e;color:#8fb7e0;font-weight:600}"
           ".on{color:#39d98a;font-weight:600}.off{color:#54637a}code{color:#e0b54a}"
           "#live{float:right;font-size:12px}"
           "#log{background:#070b10;border:1px solid #1e2a38;border-radius:6px;padding:8px;"
           "height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;"
           "font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.45;color:#9fb4cc}"
           "</style></head><body>");

    h += F("<span id='live' class='off'>connecting</span>");
    h += F("<h1>LookingGlass Panel</h1><div class='sub'>");
    h += FW_NAME; h += F(" v"); h += FW_VERSION; h += F("</div>");

    // Status
    h += F("<div class='card'><b>STATUS</b><table>");
    h += F("<tr><th>Uptime</th><td id='uptime'>"); h += up; h += F(" s</td></tr>");
    h += F("<tr><th>Free heap</th><td id='heap'>"); h += ESP.getFreeHeap(); h += F(" B</td></tr>");
    h += F("<tr><th>Total events</th><td id='events'>"); h += t.total_events; h += F("</td></tr>");
    h += F("</table></div>");

    // Network
    h += F("<div class='card'><b>NETWORK</b><table>");
    h += F("<tr><th>AP SSID</th><td><code>"); h += CFG_AP_SSID; h += F("</code></td></tr>");
    h += F("<tr><th>AP security</th><td>"); h += g_ap_secure ? F("WPA2") : F("open"); h += F("</td></tr>");
    h += F("<tr><th>AP channel</th><td>"); h += g_ap_channel; h += F("</td></tr>");
    h += F("<tr><th>AP IP</th><td>"); h += WiFi.softAPIP().toString(); h += F("</td></tr>");
    h += F("<tr><th>AP MAC</th><td>"); h += WiFi.softAPmacAddress(); h += F("</td></tr>");
    h += F("<tr><th>AP clients</th><td id='apclients'>"); h += WiFi.softAPgetStationNum(); h += F("</td></tr>");
    h += F("<tr><th>WiFi STA</th><td id='sta'>");
    if (sta_up) {
        h += F("connected "); h += WiFi.localIP().toString();
        h += F(" ("); h += WiFi.RSSI(); h += F(" dBm)");
    } else {
        h += F("not connected");
    }
    h += F("</td></tr></table></div>");

    // Buttons
    h += F("<div class='card'><b>BUTTONS</b><table>"
           "<tr><th>Name</th><th>GPIO</th><th>State</th><th>Presses</th></tr>");
    for (uint8_t i = 0; i < BUTTON_COUNT; ++i) {
        const bool down = (t.state_mask >> i) & 1u;
        h += F("<tr><td>"); h += kBtnNames[i];
        h += F("</td><td>"); h += kBtnGpios[i];
        h += F("</td><td id='st"); h += i; h += F("' class='"); h += down ? F("on") : F("off");
        h += F("'>"); h += down ? F("DOWN") : F("up");
        h += F("</td><td id='ct"); h += i; h += F("'>"); h += t.press_counts[i]; h += F("</td></tr>");
    }
    h += F("</table></div>");

    // Live log (pushed over WebSocket :81)
    h += F("<div class='card'><b>LIVE LOG</b><div id='log'></div></div>");

    // WebSocket live updates. Renders the server snapshot immediately, then
    // patches stats + appends log lines as they arrive; auto-reconnects.
    h += F("<script>(function(){"
           "var L=document.getElementById('log'),V=document.getElementById('live');"
           "function S(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}"
           "function addlog(m){var b=L.scrollTop+L.clientHeight>=L.scrollHeight-6;"
           "L.textContent+=m+'\\n';var a=L.textContent.split('\\n');"
           "if(a.length>250)L.textContent=a.slice(a.length-250).join('\\n');"
           "if(b)L.scrollTop=L.scrollHeight;}"
           "function stats(d){S('uptime',d.uptime_s+' s');S('heap',d.free_heap+' B');"
           "S('events',d.total_events);S('apclients',d.ap_clients);"
           "S('sta',d.sta_connected?('connected '+d.sta_ip+' ('+d.rssi+' dBm)'):'not connected');"
           "if(d.buttons)d.buttons.forEach(function(x,i){var s=document.getElementById('st'+i);"
           "if(s){s.textContent=x.down?'DOWN':'up';s.className=x.down?'on':'off';}S('ct'+i,x.presses);});}"
           "function go(){var w=new WebSocket('ws://'+location.hostname+':81/');"
           "w.onopen=function(){V.textContent='\\u25cf live';V.className='on';};"
           "w.onclose=function(){V.textContent='\\u25cb offline';V.className='off';setTimeout(go,2000);};"
           "w.onmessage=function(e){try{var d=JSON.parse(e.data);"
           "if(d.t==='log')addlog(d.m);else if(d.t==='stats')stats(d);}catch(_){}};}"
           "go();})();</script>");

    h += F("</body></html>");
    return h;
}

static String render_json() {
    const Telemetry t = telemetry_snapshot();
    const bool sta_up = (WiFi.status() == WL_CONNECTED);
    String j;
    j.reserve(512);
    j += F("{\"t\":\"stats\",\"fw\":\""); j += FW_NAME; j += F(" v"); j += FW_VERSION; j += F("\"");
    j += F(",\"uptime_s\":"); j += millis() / 1000;
    j += F(",\"free_heap\":"); j += ESP.getFreeHeap();
    j += F(",\"total_events\":"); j += t.total_events;
    j += F(",\"sta_connected\":"); j += sta_up ? F("true") : F("false");
    j += F(",\"sta_ip\":\""); j += sta_up ? WiFi.localIP().toString() : String("");
    j += F("\",\"rssi\":"); j += sta_up ? WiFi.RSSI() : 0;
    j += F(",\"ap_ssid\":\""); j += CFG_AP_SSID;
    j += F("\",\"ap_security\":\""); j += g_ap_secure ? F("WPA2") : F("open");
    j += F("\",\"ap_channel\":"); j += g_ap_channel;
    j += F(",\"ap_ip\":\""); j += WiFi.softAPIP().toString();
    j += F("\",\"ap_clients\":"); j += WiFi.softAPgetStationNum();
    j += F(",\"buttons\":[");
    for (uint8_t i = 0; i < BUTTON_COUNT; ++i) {
        if (i) j += F(",");
        j += F("{\"name\":\""); j += kBtnNames[i];
        j += F("\",\"gpio\":"); j += kBtnGpios[i];
        j += F(",\"down\":"); j += ((t.state_mask >> i) & 1u) ? F("true") : F("false");
        j += F(",\"presses\":"); j += t.press_counts[i]; j += F("}");
    }
    j += F("]}");
    return j;
}

// ---- handlers ------------------------------------------------
static void handle_root() { g_server.send(200, "text/html", render_html()); }
static void handle_api()  { g_server.send(200, "application/json", render_json()); }

// Captive-portal catch-all: redirect every other request (incl. the OS
// connectivity probes) to the portal page, which makes the "sign-in" sheet
// pop automatically on most phones/laptops.
static void handle_not_found() {
    g_server.sendHeader("Location",
                        String("http://") + WiFi.softAPIP().toString() + "/", true);
    g_server.send(302, "text/plain", "");
}

// Wrap a raw log line as a {"t":"log","m":"…"} WebSocket message (JSON-escaped).
static String ws_log_msg(const char *line) {
    String m;
    m.reserve(strlen(line) + 24);
    m += F("{\"t\":\"log\",\"m\":\"");
    for (const char *p = line; *p; ++p) {
        const char c = *p;
        if (c == '\\' || c == '"') { m += '\\'; m += c; }
        else if (c == '\n' || c == '\r') { m += ' '; }
        else m += c;
    }
    m += F("\"}");
    return m;
}

static void log_hist_push(const char *line) {
    g_log_hist[g_log_hist_head] = line;
    g_log_hist_head = (g_log_hist_head + 1) % LOG_HIST_MAX;
    if (g_log_hist_count < LOG_HIST_MAX) g_log_hist_count++;
}

// On a new WebSocket client: send the current stats, then replay recent log
// history (chronological) so the live panel isn't empty.
static void ws_event(uint8_t num, WStype_t type, uint8_t *payload, size_t len) {
    (void)payload;
    (void)len;
    if (type == WStype_CONNECTED) {
        String snap = render_json();
        g_ws.sendTXT(num, snap);
        const int start = (g_log_hist_count < LOG_HIST_MAX) ? 0 : g_log_hist_head;
        for (int k = 0; k < g_log_hist_count; ++k) {
            const int idx = (start + k) % LOG_HIST_MAX;
            String lm = ws_log_msg(g_log_hist[idx].c_str());
            g_ws.sendTXT(num, lm);
        }
    }
}

// Log station-link events (association, IP, and disconnect REASON codes —
// reason 15 = handshake timeout/bad password, 201 = AP not found, etc.).
static void on_wifi_event(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            panel_log("NET STA associated to %s", CFG_WIFI_SSID);
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            panel_log("NET STA connected: %s ip=%s rssi=%d",
                      WiFi.SSID().c_str(),
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            panel_log("NET STA disconnected (reason=%d)",
                      info.wifi_sta_disconnected.reason);
            break;
        default:
            break;
    }
}

// ---- the core-0 networking task ------------------------------
static void portal_task(void *) {
    WiFi.persistent(false);            // don't wear flash storing creds
    WiFi.onEvent(on_wifi_event);
    WiFi.mode(WIFI_AP_STA);
    WiFi.setHostname(CFG_HOSTNAME);

    // A single radio can only be on one channel: in AP+STA the SoftAP and the
    // station MUST share a channel, or the STA 4-way handshake times out
    // (reason=15). So scan for the station network first and host the AP on
    // its channel. (Also tells us if the network is even visible / 2.4 GHz.)
    int ap_channel = CFG_AP_CHANNEL;
#if CFG_WIFI_ENABLED
    const int found = WiFi.scanNetworks();
    for (int i = 0; i < found; ++i) {
        if (WiFi.SSID(i) == CFG_WIFI_SSID) {
            ap_channel = WiFi.channel(i);
            panel_log("NET found %s on channel %d (%d dBm)",
                      CFG_WIFI_SSID, ap_channel, WiFi.RSSI(i));
            break;
        }
    }
    if (found <= 0 || ap_channel == CFG_AP_CHANNEL) {
        panel_log("NET %s not found in scan (got %d nets); AP stays on ch %d",
                  CFG_WIFI_SSID, found, ap_channel);
    }
    WiFi.scanDelete();
#endif

#if CFG_AP_ENABLED
    // Empty password (sizeof 1) => open AP; otherwise WPA2.
    const char *ap_pw = (sizeof(CFG_AP_PASSWORD) > 1) ? CFG_AP_PASSWORD : nullptr;
    WiFi.softAP(CFG_AP_SSID, ap_pw, ap_channel, CFG_AP_HIDDEN ? 1 : 0);
#endif
#if CFG_WIFI_ENABLED
    WiFi.setAutoReconnect(true);
    WiFi.begin(CFG_WIFI_SSID, CFG_WIFI_PASSWORD);
#endif

    g_ap_channel = ap_channel;
    const IPAddress ap_ip = WiFi.softAPIP();

#if CFG_WEB_CAPTIVE
    g_dns.setErrorReplyCode(DNSReplyCode::NoError);
    g_dns.start(kDnsPort, "*", ap_ip);   // resolve every host to us
#endif

    g_server.on("/", handle_root);
    g_server.on("/api/telemetry", handle_api);
    g_server.onNotFound(handle_not_found);
    g_server.begin();

    g_ws.begin();
    g_ws.onEvent(ws_event);

    panel_log("NET portal up: AP=%s ch=%d security=%s ip=%s web=:%d ws=:81 url=http://%s/ (core %d)",
              CFG_AP_SSID, ap_channel, g_ap_secure ? "WPA2" : "open",
              ap_ip.toString().c_str(), CFG_WEB_PORT,
              ap_ip.toString().c_str(), xPortGetCoreID());

    uint32_t last_status = 0, last_stats = 0;
    char logline[160];
    for (;;) {
#if CFG_WEB_CAPTIVE
        g_dns.processNextRequest();
#endif
        g_server.handleClient();
        g_ws.loop();

        // Drain queued log lines -> recent history + push to all WS clients.
        for (int k = 0; k < 12 && log_bus_pop(logline, sizeof(logline)); ++k) {
            log_hist_push(logline);
            String lm = ws_log_msg(logline);
            g_ws.broadcastTXT(lm);
        }

        const uint32_t now = millis();
        // Push live stats a few times a second.
        if (now - last_stats >= 500) {
            last_stats = now;
            String st = render_json();
            g_ws.broadcastTXT(st);
        }
        // Periodic status line (also rides the log stream via panel_log).
        if (now - last_status >= 5000) {
            last_status = now;
            panel_log("NET status: sta=%s ap_clients=%u heap=%u",
                      WiFi.status() == WL_CONNECTED ? "up" : "down",
                      (unsigned)WiFi.softAPgetStationNum(),
                      (unsigned)ESP.getFreeHeap());
        }
        vTaskDelay(pdMS_TO_TICKS(2));   // yield; keeps WiFi/idle tasks happy
    }
}

void net_portal_begin() {
#if CFG_WEB_ENABLED
    // 12 KB stack: WiFi + HTTP handlers building the page need headroom.
    xTaskCreatePinnedToCore(portal_task, "portal", 12288, nullptr, 1, nullptr, 0);
#endif
}
