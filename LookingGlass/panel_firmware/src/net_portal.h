#pragma once
// net_portal.h — WiFi (AP + STA), captive portal, and telemetry web server.
//
// net_portal_begin() spins up a FreeRTOS task PINNED TO CORE 0 that owns all
// networking, so the button scanner on core 1 (Arduino loop) is never blocked
// by WiFi or HTTP work. The task brings up a SoftAP (the captive-portal
// network you join), optionally joins a station network, runs a catch-all DNS
// server so the portal pops automatically, and serves a live telemetry page.
void net_portal_begin();
