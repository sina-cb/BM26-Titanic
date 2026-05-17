// BLE GATT layout — mirrors control_podium/firmware/src/titanic_ble.h.
// Each Heltec running podium_tx / server_rx exposes this same service.
// They advertise as `tcon_<node-name>` (e.g. `tcon_sina`, `tcon_server`);
// the iPhone app filters by SERVICE UUID at scan time and lets the
// user pick whichever controller they're standing next to.

export const TITANIC_SERVICE = "a0e3f001-1c3d-4b60-a0e3-000000000000";

export const CHAR_ROLE = "a0e3f001-1c3d-4b60-a0e3-000000000001";
export const CHAR_FW_VER = "a0e3f001-1c3d-4b60-a0e3-000000000002";
export const CHAR_UPTIME = "a0e3f001-1c3d-4b60-a0e3-000000000003";

export const CHAR_TX_COUNT = "a0e3f001-1c3d-4b60-a0e3-000000000010";
export const CHAR_RX_COUNT = "a0e3f001-1c3d-4b60-a0e3-000000000011";
export const CHAR_LAST_RSSI = "a0e3f001-1c3d-4b60-a0e3-000000000012";
export const CHAR_LAST_SNR = "a0e3f001-1c3d-4b60-a0e3-000000000013";

export const CHAR_FREQ = "a0e3f001-1c3d-4b60-a0e3-000000000020";
export const CHAR_SF = "a0e3f001-1c3d-4b60-a0e3-000000000021";
export const CHAR_BW = "a0e3f001-1c3d-4b60-a0e3-000000000022";
export const CHAR_TXPOW = "a0e3f001-1c3d-4b60-a0e3-000000000023";

// Phone → firmware: each write triggers a LoRa TX of the ASCII string.
export const CHAR_CMD = "a0e3f001-1c3d-4b60-a0e3-000000000030";

// Firmware → phone: notifies on every received LoRa frame (raw ASCII).
export const CHAR_LAST_RX = "a0e3f001-1c3d-4b60-a0e3-000000000031";

// All Heltec controllers (captain + server + future crew) advertise
// themselves as `tcon_<name>` — `tcon` = Titanic CONtroller, `<name>`
// comes from the `name:` field in `control_podium/.config.nodes.yaml`.
// Lower-case + underscore matches the Unix-y feel of the YAML keys
// and gives us names that are easy to type in logs / serial. The
// iPhone app intentionally lets the user pick whichever one they're
// standing next to, since either entry point is useful:
//
//   * captain (`tcon_sina`, `tcon_misha`, …) — normal range-test path:
//     phone → BLE → captain → LoRa → server → bridge → MarsinEngine.
//   * server  (`tcon_server`)                — local debug path: phone
//     → BLE → server → bridge → MarsinEngine. Skips the LoRa hop
//     entirely, which is handy for verifying the AEAD codec end-to-
//     end without chasing a bad antenna.
//
// The OS-level scan filter is by SERVICE UUID (TITANIC_SERVICE), so
// the name prefix is only used for cosmetic display + a defence-in-
// depth check that the device we connected to is on-mesh and not
// some random GATT server squatting on the same UUID.
export const ADVERTISED_NAME_PREFIX = "tcon_";

// Returns true if `name` looks like one of our Heltec advertisements.
// Matches case-insensitively because some BLE stacks normalise local
// names; we want to be liberal in what we accept here so the user
// never gets a "no devices found" message just because of a stray
// upper-case letter.
export function isTitanicName(name: string | null | undefined): boolean {
    if (!name) return false;
    return name.toLowerCase().startsWith(ADVERTISED_NAME_PREFIX);
}
