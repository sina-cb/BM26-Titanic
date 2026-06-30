"""PlatformIO pre-build hook: bake panel_firmware/config.yaml + secrets.yaml
into include/generated/net_config.h.

config.yaml (in the firmware's main dir) is the single source of truth for ALL
build-time tunables — firmware identity, serial, button timing, the lamp, the
status LED, and the network settings. Only the structural button->GPIO map
(BUTTON_TABLE) and the reserved-pin list stay in include/config.h.

Runs before every build (wired via `extra_scripts = pre:scripts/gen_config.py`).
No third-party deps — a tiny YAML-subset parser handles our config files so the
build works on a bare PlatformIO penv. Per the project's "fail loudly, no
fallback" rule, a missing config/secrets file or a missing required key aborts
the build with a clear message instead of guessing.
"""
import os
import re

Import("env")  # noqa: F821  (injected by PlatformIO/SCons)

PROJECT_DIR = env["PROJECT_DIR"]                      # noqa: F821
LOOKINGGLASS_DIR = os.path.abspath(os.path.join(PROJECT_DIR, ".."))
# config.yaml now lives in the firmware's main dir (single source of truth).
CONFIG_PATH = os.path.join(PROJECT_DIR, "config.yaml")
# Secrets live in the shared, private BM26-Firmware-Deployment repo, exposed via
# that repo's env vars ($BM26_SECRETS, or the Stoker-named $STOKER_SECRETS — both
# point at the same secrets.yaml). Run its setup_env.ps1 / setup_env.sh once.
SECRETS_PATH = os.environ.get("BM26_SECRETS") or os.environ.get("STOKER_SECRETS")
OUT_PATH = os.path.join(PROJECT_DIR, "include", "generated", "net_config.h")


def fail(msg):
    raise SystemExit("\n[gen_config] ERROR: %s\n" % msg)


def _strip_comment(s):
    out, quote = [], None
    for c in s:
        if quote:
            out.append(c)
            if c == quote:
                quote = None
        elif c in ('"', "'"):
            quote = c
            out.append(c)
        elif c == "#":
            break
        else:
            out.append(c)
    return "".join(out)


def _scalar(v):
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        return v[1:-1]
    low = v.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    try:
        return int(v)
    except ValueError:
        return v


def parse_yaml(path):
    """Minimal YAML-subset parser: comments, 2-space-indent nested maps,
    and `key: value` scalars. Sufficient for our config files only."""
    root = {}
    stack = [(-1, root)]  # (indent, container)
    with open(path, "r", encoding="utf-8") as f:
        for n, raw in enumerate(f, 1):
            line = _strip_comment(raw.rstrip("\n"))
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip(" "))
            content = line.strip()
            if ":" not in content:
                fail("%s line %d: expected 'key:' or 'key: value'" % (path, n))
            key, _, val = content.partition(":")
            key, val = key.strip(), val.strip()
            while indent <= stack[-1][0]:
                stack.pop()
            parent = stack[-1][1]
            if val == "":
                child = {}
                parent[key] = child
                stack.append((indent, child))
            else:
                parent[key] = _scalar(val)
    return root


def get(tree, dotted, default=None, required=False, src="config.yaml"):
    cur = tree
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            if required:
                fail("missing required key '%s' in %s" % (dotted, src))
            return default
        cur = cur[part]
    return cur


def cstr(s):
    s = str(s).replace("\\", "\\\\").replace('"', '\\"')
    return '"%s"' % s


def onoff(v):
    return 1 if v else 0


def main():
    if not os.path.isfile(CONFIG_PATH):
        fail("config.yaml not found at %s" % CONFIG_PATH)
    if not SECRETS_PATH or not os.path.isfile(SECRETS_PATH):
        fail(
            "secrets file not found (got: %r).\n"
            "  -> set $BM26_SECRETS (or $STOKER_SECRETS) to the\n"
            "     BM26-Firmware-Deployment/secrets.yaml. Run that repo's\n"
            "     setup_env.ps1 / setup_env.sh once to register it."
            % SECRETS_PATH
        )

    cfg = parse_yaml(CONFIG_PATH)
    sec = parse_yaml(SECRETS_PATH)

    # ---- firmware identity & serial ----
    fw_name = get(cfg, "firmware.name", required=True)
    fw_version = get(cfg, "firmware.version", required=True)
    serial_baud = int(get(cfg, "firmware.serial_baud", default=115200))
    serial_hb = int(get(cfg, "firmware.serial_heartbeat_ms", default=2000))

    # ---- button gesture timing ----
    debounce_ms = int(get(cfg, "buttons.debounce_ms", default=15))
    long_ms = int(get(cfg, "buttons.long_press_ms", default=600))
    double_ms = int(get(cfg, "buttons.double_press_ms", default=250))
    hold_ms = int(get(cfg, "buttons.hold_repeat_ms", default=200))

    # ---- illuminated-button lamp ----
    lamp_enabled = bool(get(cfg, "lamp.enabled", default=False))
    lamp_pin = int(get(cfg, "lamp.pin", required=lamp_enabled, default=18))
    lamp_source = get(cfg, "lamp.source", required=lamp_enabled, default="ARCADE_4")
    if lamp_enabled and not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", str(lamp_source)):
        fail("lamp.source %r is not a valid button id token (e.g. ARCADE_4)" % lamp_source)
    lamp_active_high = bool(get(cfg, "lamp.active_high", default=True))
    lamp_dim = int(get(cfg, "lamp.dim", default=0))
    lamp_full = int(get(cfg, "lamp.full", default=255))
    lamp_freq = int(get(cfg, "lamp.pwm_freq", default=1000))
    lamp_bits = int(get(cfg, "lamp.pwm_bits", default=8))

    # ---- status LED ----
    led_enabled = bool(get(cfg, "status_led.enabled", default=False))
    led_pin = int(get(cfg, "status_led.pin", default=21))
    led_count = int(get(cfg, "status_led.count", default=1))
    led_bright = int(get(cfg, "status_led.brightness", default=40))
    led_hb = int(get(cfg, "status_led.heartbeat_ms", default=4000))
    led_flash = int(get(cfg, "status_led.flash_ms", default=120))
    led_refresh = int(get(cfg, "status_led.refresh_ms", default=16))

    # ---- network (non-secret) + secrets ----
    hostname = get(cfg, "device.hostname", required=True)

    ap_enabled = bool(get(cfg, "ap.enabled", default=True))
    ap_ssid = get(cfg, "ap.ssid", required=True)
    ap_channel = int(get(cfg, "ap.channel", default=6))
    ap_hidden = bool(get(cfg, "ap.hidden", default=False))
    ap_password = get(sec, "ap_pass", default="", src="secrets.yaml")   # flat key

    wifi_enabled = bool(get(cfg, "wifi.enabled", default=True))
    wifi_ssid = get(sec, "wifi_ssid", required=wifi_enabled, src="secrets.yaml", default="")
    wifi_password = get(sec, "wifi_pass", required=wifi_enabled, src="secrets.yaml", default="")

    lan_enabled = bool(get(cfg, "lan.enabled", default=False))
    lan_dhcp = bool(get(cfg, "lan.dhcp", default=True))
    lan_static_ip = get(cfg, "lan.static_ip", default="0.0.0.0")
    lan_gateway = get(cfg, "lan.gateway", default="0.0.0.0")
    lan_netmask = get(cfg, "lan.netmask", default="255.255.255.0")

    web_enabled = bool(get(cfg, "web.enabled", default=True))
    web_port = int(get(cfg, "web.port", default=80))
    web_captive = bool(get(cfg, "web.captive_portal", default=True))

    lines = [
        "// AUTO-GENERATED by scripts/gen_config.py — DO NOT EDIT, DO NOT COMMIT.",
        "// Baked from panel_firmware/config.yaml + secrets.yaml.",
        "#pragma once",
        "",
        "// ---- firmware identity & serial ----",
        "#define FW_NAME             %s" % cstr(fw_name),
        "#define FW_VERSION          %s" % cstr(fw_version),
        "#define SERIAL_BAUD         %d" % serial_baud,
        "#define SERIAL_HEARTBEAT_MS %d" % serial_hb,
        "",
        "// ---- button gesture timing ----",
        "#define DEBOUNCE_MS         %d" % debounce_ms,
        "#define LONG_PRESS_MS       %d" % long_ms,
        "#define DOUBLE_PRESS_MS     %d" % double_ms,
        "#define HOLD_REPEAT_MS      %d" % hold_ms,
        "",
        "// ---- illuminated-button lamp ----",
        "#define BUTTON_LAMP_ENABLED     %d" % onoff(lamp_enabled),
        "#define BUTTON_LAMP_PIN         %d" % lamp_pin,
        "#define BUTTON_LAMP_SOURCE      BTN_%s" % lamp_source,
        "#define BUTTON_LAMP_ACTIVE_HIGH %d" % onoff(lamp_active_high),
        "#define BUTTON_LAMP_DIM         %d" % lamp_dim,
        "#define BUTTON_LAMP_FULL        %d" % lamp_full,
        "#define BUTTON_LAMP_PWM_FREQ    %d" % lamp_freq,
        "#define BUTTON_LAMP_PWM_BITS    %d" % lamp_bits,
        "",
        "// ---- status LED ----",
        "#define STATUS_LED_ENABLED      %d" % onoff(led_enabled),
        "#define STATUS_LED_PIN          %d" % led_pin,
        "#define STATUS_LED_COUNT        %d" % led_count,
        "#define STATUS_LED_BRIGHTNESS   %d" % led_bright,
        "#define STATUS_LED_HEARTBEAT_MS %d" % led_hb,
        "#define STATUS_LED_FLASH_MS     %d" % led_flash,
        "#define STATUS_LED_REFRESH_MS   %d" % led_refresh,
        "",
        "// ---- network ----",
        "#define CFG_HOSTNAME        %s" % cstr(hostname),
        "",
        "#define CFG_AP_ENABLED      %d" % onoff(ap_enabled),
        "#define CFG_AP_SSID         %s" % cstr(ap_ssid),
        "#define CFG_AP_PASSWORD     %s" % cstr(ap_password),
        "#define CFG_AP_CHANNEL      %d" % ap_channel,
        "#define CFG_AP_HIDDEN       %d" % onoff(ap_hidden),
        "",
        "#define CFG_WIFI_ENABLED    %d" % onoff(wifi_enabled),
        "#define CFG_WIFI_SSID       %s" % cstr(wifi_ssid),
        "#define CFG_WIFI_PASSWORD   %s" % cstr(wifi_password),
        "",
        "#define CFG_LAN_ENABLED     %d" % onoff(lan_enabled),
        "#define CFG_LAN_DHCP        %d" % onoff(lan_dhcp),
        "#define CFG_LAN_STATIC_IP   %s" % cstr(lan_static_ip),
        "#define CFG_LAN_GATEWAY     %s" % cstr(lan_gateway),
        "#define CFG_LAN_NETMASK     %s" % cstr(lan_netmask),
        "",
        "#define CFG_WEB_ENABLED     %d" % onoff(web_enabled),
        "#define CFG_WEB_PORT        %d" % web_port,
        "#define CFG_WEB_CAPTIVE     %d" % onoff(web_captive),
        "",
    ]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    # Console summary — never print secret values.
    print("[gen_config] wrote %s" % os.path.relpath(OUT_PATH, PROJECT_DIR))
    print("[gen_config]   fw   : %s v%s (serial %d, heartbeat %dms)"
          % (fw_name, fw_version, serial_baud, serial_hb))
    print("[gen_config]   lamp : enabled=%s pin=%d source=BTN_%s dim=%d full=%d"
          % (lamp_enabled, lamp_pin, lamp_source, lamp_dim, lamp_full))
    print("[gen_config]   AP   : %s (enabled=%s, ch=%d)" % (ap_ssid, ap_enabled, ap_channel))
    print("[gen_config]   WiFi : ssid=%s (enabled=%s) [password hidden]" % (wifi_ssid, wifi_enabled))
    print("[gen_config]   Web  : port=%d (enabled=%s, captive=%s)" % (web_port, web_enabled, web_captive))


main()
