"""
Discovery — Find Heltec controllers by MAC address, independent of COM port.
"""

import serial.tools.list_ports

# Known USB Vendor IDs for Heltec-compatible boards
KNOWN_VIDS = {
    0x303A,  # Espressif ESP32-S3 native USB
    0x10C4,  # Silicon Labs CP210x
    0x1A86,  # QinHeng CH9102 / CH340
}


def scan_ports():
    """Return all serial ports with USB device metadata."""
    results = []
    for port in serial.tools.list_ports.comports():
        results.append({
            "port": port.device,
            "mac": port.serial_number,
            "vid": f"{port.vid:04X}" if port.vid else None,
            "pid": f"{port.pid:04X}" if port.pid else None,
            "description": port.description,
            "location": port.location,
            "is_heltec": port.vid in KNOWN_VIDS if port.vid else False,
        })
    return results


def _normalize_mac(mac):
    """Strip colons/dashes and uppercase for comparison."""
    if not mac:
        return ""
    return mac.upper().replace(":", "").replace("-", "")


def find_port_by_mac(mac):
    """Find the current COM port for a given MAC address. Returns port string or None."""
    if not mac:
        return None
    target = _normalize_mac(mac)
    for p in scan_ports():
        if _normalize_mac(p["mac"]) == target:
            return p["port"]
    return None


def match_port_to_node(port_info, config):
    """Try to match a scanned port to a node in config by MAC. Returns node name or None."""
    mac = port_info.get("mac")
    if not mac:
        return None
    target = _normalize_mac(mac)
    for name, node in config.get("nodes", {}).items():
        # Support both usb_mac (new) and mac (legacy)
        node_mac = node.get("usb_mac") or node.get("mac")
        if node_mac and _normalize_mac(node_mac) == target:
            return name
    return None


def find_unassigned_slot(config):
    """Find the first node slot in config with no USB MAC. Returns name or None."""
    for name, node in config.get("nodes", {}).items():
        # Support both usb_mac (new) and mac (legacy)
        if not (node.get("usb_mac") or node.get("mac")):
            return name
    return None
