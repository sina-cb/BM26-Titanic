// BLE wrapper around react-native-ble-plx.
//
// Lifecycle:
//   1. `requestPermissions()` — iOS pops the Bluetooth dialog the first
//      time. Returns true if usable.
//   2. `startScan(onDevice)` — emits each Heltec we see, deduplicated.
//   3. `connect(deviceId)` — connects, discovers services, FORCES a
//      pairing handshake by reading the encrypted CHAR_LAST_RX (which
//      makes iOS pop its system "Bluetooth Pairing Request" dialog the
//      first time the user touches a given controller), then subscribes
//      to the Last-RX notification characteristic.
//   4. `writeFrame(line)` — writes one Titanic Frame v2 line to the
//      Command characteristic; firmware transmits it verbatim. The
//      WRITE_ENC permission on the firmware side guarantees this only
//      succeeds on a paired+bonded link.
//   5. `disconnect()` — drops the link. The bond persists in iOS's
//      Bluetooth settings and in the Heltec's NVS, so subsequent
//      connects don't re-prompt for the PIN.
//
// Notifications come back via `onLineReceived(line)` registered at
// connect time. The link layer then routes them through the Codec.

import {
  BleError,
  BleManager,
  Device,
  Subscription,
} from "react-native-ble-plx";
import { PermissionsAndroid, Platform } from "react-native";
import {
  CHAR_CMD,
  CHAR_LAST_RSSI,
  CHAR_LAST_RX,
  CHAR_LAST_SNR,
  CHAR_RX_COUNT,
  CHAR_TX_COUNT,
  TITANIC_SERVICE,
  isTitanicName,
} from "./uuids";
// Behavior tunables (BLE MTU, connect timeout, RSSI poll cadence,
// state-probe timeout) — all sourced from .config.portwatch.yaml
// via scripts/sync-config.mjs. See src/config/index.ts.
import { CFG } from "../config";

// Last-resort label when the firmware doesn't include a name in the
// advertisement OR scan response packet (older NimBLE builds drop the
// local-name field whenever the 128-bit service UUID + flags AD already
// fill the 31-byte primary advertisement). The id is a CoreBluetooth
// UUID on iOS / a MAC address on Android — we just use the last 6 chars
// so the user has something stable to disambiguate two controllers
// sitting on a table next to each other. Lower-case `tcon_` prefix
// matches the firmware naming convention (`tcon_<name>` from
// .config.nodes.yaml) so the synthesized label is visually consistent
// with real ones.
function fallbackName(deviceId: string): string {
  const tail = deviceId.replace(/[^A-Za-z0-9]/g, "").slice(-6).toLowerCase();
  return `tcon_${tail}`;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number;
  /**
   * Wall-clock millis of the first advertisement we received from this
   * device this scan session. Used by the UI as a stable secondary sort
   * key so two devices with similar RSSI don't keep trading places in
   * the list — see ScanScreen's bucket-sort.
   */
  firstSeenMs: number;
}

/** Per-device scan-throttle bookkeeping (RSSI smoothing + emit cadence). */
interface ScanThrottleEntry {
  rssiEma: number;
  lastEmitMs: number;
  firstSeenMs: number;
}

export interface ConnectedHandles {
  device: Device;
  rxSubscription: Subscription;
  rssiSubscription?: Subscription;
}

export type ConnectionState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "connecting"; deviceId: string }
  | { kind: "connected"; deviceId: string; deviceName: string }
  | { kind: "error"; message: string };

export class BleClient {
  private manager: BleManager;
  private connected: ConnectedHandles | null = null;
  private scanCallback: ((d: DiscoveredDevice) => void) | null = null;
  private scanErrorCallback: ((msg: string) => void) | null = null;
  private rxCallback: ((line: string) => void) | null = null;
  private linkCallback: ((rssi: number | null) => void) | null = null;
  /**
   * Per-device scan state: smoothed RSSI + last UI-emit timestamp +
   * first-seen timestamp. Cleared by stopScan() / resetScanThrottle()
   * so a new scan session starts fresh and doesn't carry stale EMAs.
   *
   * Why per-device:
   *   - allowDuplicates is on (we want live RSSI for range testing),
   *     so each device fires the scan callback ~10 Hz. Without this
   *     map every advert hits React, which manifests as flicker on
   *     the scan list (rows re-render and re-sort 10×/sec/device).
   *   - Throttling globally would smooth the wrong thing: a device
   *     that just appeared would have to wait its turn behind a
   *     louder neighbour. Per-device cadence gives every radio its
   *     own ~2 Hz UI update budget.
   */
  private scanThrottle: Map<string, ScanThrottleEntry> = new Map();

  constructor() {
    this.manager = new BleManager();
  }

  /** Request iOS / Android permissions. Returns true if usable. */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === "android") {
      const sdk = Platform.Version as number;
      if (sdk >= 31) {
        const res = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        return Object.values(res).every(
          (v) => v === PermissionsAndroid.RESULTS.GRANTED,
        );
      }
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    }
    // iOS: permission is requested implicitly by react-native-ble-plx
    // on the first scan/connect. We just need to wait for PoweredOn.
    return new Promise<boolean>((resolve) => {
      const sub = this.manager.onStateChange((state) => {
        if (state === "PoweredOn") {
          sub.remove();
          resolve(true);
        } else if (state === "Unsupported" || state === "Unauthorized") {
          sub.remove();
          resolve(false);
        }
      }, true);
      // Bail after CFG.ble.state_probe_timeout_ms rather than hang forever.
      setTimeout(() => {
        sub.remove();
        resolve(false);
      }, CFG.ble.state_probe_timeout_ms);
    });
  }

  /**
   * Continuously scan for Heltec captain radios.
   *
   * IMPORTANT — we filter at the OS level by SERVICE UUID, not by name.
   *
   * The Heltec firmware advertises a 128-bit service UUID
   * (TITANIC_SERVICE) plus the local name "TCon-<short>". A 128-bit
   * UUID + flags already eats ~21 of the 31 advertising-packet bytes,
   * so the 13-byte name AD field overflows. NimBLE puts it in the
   * scan response packet (titanic_ble.h sets that explicitly via
   * setScanResponseData), but older units in the field may still be
   * advertising name-less, so the iPhone has to be robust either way.
   *
   * Filtering by UUID instead of by name has two big wins:
   *   - the OS handles the discrimination in the BLE driver, so the
   *     callback only fires for our radios (no battery-burning every-
   *     advertisement wakeup), and
   *   - we don't depend on the name reaching us at all — if the scan
   *     response is missing we still find the device.
   *
   * `allowDuplicates: true` is critical for range testing — we want
   * the live RSSI to keep updating in the device list as the user
   * walks around. The store dedupes by id; we just keep overwriting
   * the rssi on each callback.
   */
  startScan(
    onDevice: (d: DiscoveredDevice) => void,
    onError?: (msg: string) => void,
  ): void {
    this.stopScan();
    this.scanCallback = onDevice;
    this.scanErrorCallback = onError ?? null;
    this.manager.startDeviceScan(
      [TITANIC_SERVICE],
      { allowDuplicates: true },
      (err, device) => {
        if (err) {
          // Throwing inside an async ble-plx callback is silently
          // swallowed on the bridge side — surface it to the caller
          // instead so the UI can render "scan failed: ...".
          const msg = (err as BleError)?.message ?? String(err);
          this.scanErrorCallback?.(msg);
          this.scanCallback = null;
          return;
        }
        if (!device) return;

        // Per-device throttle + RSSI smoothing. allowDuplicates fires
        // this callback ~10×/sec/device, which would dominate the
        // React render budget AND make the rendered RSSI digits flip
        // every frame because real-world RSSI naturally jitters by
        // ±3-5 dBm between adverts. We:
        //   1. Apply an EMA (alpha=0.35) so the displayed value is a
        //      low-pass of the raw stream — calmer than the raw RSSI
        //      but still moves visibly when the user walks closer.
        //   2. Only forward to the UI every SCAN_EMIT_INTERVAL_MS so
        //      the React list updates ~2-4 Hz per device (smooth to
        //      the eye, fast enough to feel live). New devices skip
        //      the throttle on their very first frame so they appear
        //      instantly.
        const SCAN_EMIT_INTERVAL_MS = 400;
        const EMA_ALPHA = 0.35;

        const now = Date.now();
        const rawRssi = device.rssi ?? -100;
        let entry = this.scanThrottle.get(device.id);
        const isFirstSighting = entry === undefined;
        if (!entry) {
          entry = {
            rssiEma: rawRssi,
            lastEmitMs: 0,
            firstSeenMs: now,
          };
          this.scanThrottle.set(device.id, entry);
        } else {
          entry.rssiEma =
            entry.rssiEma * (1 - EMA_ALPHA) + rawRssi * EMA_ALPHA;
        }

        if (
          !isFirstSighting &&
          now - entry.lastEmitMs < SCAN_EMIT_INTERVAL_MS
        ) {
          return;
        }
        entry.lastEmitMs = now;

        // Cosmetic name only — the OS-level service-UUID filter is
        // what guarantees this is a Titanic radio. If the firmware
        // managed to fit the local name on the air (or in a scan
        // response), use it; otherwise fall back to a synthetic
        // `tcon_xxxxxx` derived from the device id so the user
        // has a stable label to tap on.
        const advertisedName = device.localName || device.name || "";
        const display = isTitanicName(advertisedName)
          ? advertisedName
          : advertisedName || fallbackName(device.id);
        if (this.scanCallback) {
          this.scanCallback({
            id: device.id,
            name: display,
            rssi: Math.round(entry.rssiEma),
            firstSeenMs: entry.firstSeenMs,
          });
        }
      },
    );
  }

  stopScan(): void {
    if (this.scanCallback) {
      this.manager.stopDeviceScan();
      this.scanCallback = null;
      this.scanErrorCallback = null;
    }
    // Drop per-device EMA / throttle state so the next scan starts
    // fresh (no stale "this device is at -88 dBm" carried over from
    // before the user walked across the camp).
    this.scanThrottle.clear();
  }

  /**
   * Connect to a discovered Heltec, discover services, and subscribe
   * to the LAST_RX notification stream.
   *
   * `onLine` receives each raw notification payload (ASCII line).
   * `onRssi` is called periodically with the live link RSSI from
   *   `readRSSI()` polls (every ~3 s). Pass null in error.
   */
  async connect(
    deviceId: string,
    onLine: (line: string) => void,
    onRssi?: (rssi: number | null) => void,
  ): Promise<{ deviceName: string }> {
    this.stopScan();
    this.rxCallback = onLine;
    this.linkCallback = onRssi ?? null;

    let device: Device;
    try {
      device = await this.manager.connectToDevice(deviceId, {
        autoConnect: false,
        // MTU + connect timeout both come from
        // .config.portwatch.yaml::ble (see scripts/sync-config.mjs).
        // Heltec/NimBLE happily negotiates the requested MTU; bigger
        // MTU = fewer fragments per LoRa `rep` page.
        requestMTU: CFG.ble.request_mtu,
        timeout: CFG.ble.connect_timeout_ms,
      });
    } catch (err) {
      throw bleErr("connect", err);
    }

    try {
      await device.discoverAllServicesAndCharacteristics();
    } catch (err) {
      await device.cancelConnection().catch(() => undefined);
      throw bleErr("discover services", err);
    }

    // Force the BLE pairing handshake to happen RIGHT NOW (rather
    // than the first time the user taps "send" in the OPS panel).
    //
    // The firmware marks CHAR_LAST_RX as READ_ENC, so the very first
    // read attempt against it from an unbonded central will make iOS
    // pop its system "Bluetooth Pairing Request" dialog. The firmware
    // simultaneously wakes the OLED and force-jumps to the dedicated
    // BLE PIN page so the user can read the 6-digit PIN off the
    // Heltec without poking PRG. Once they type it in, iOS stores
    // the bond and won't prompt again on subsequent connects.
    //
    // We swallow the error explicitly: if the user dismisses the
    // pairing prompt the read fails, but we still want the connection
    // object so the UI can surface a "pairing required" warning rather
    // than silently sit on a half-broken connection.
    try {
      await device.readCharacteristicForService(TITANIC_SERVICE, CHAR_LAST_RX);
    } catch (err) {
      const e = err as BleError;
      // 401 / 403 / "Insufficient Authentication" all mean "the user
      // hasn't paired yet". Anything else (timeout, disconnected, etc.)
      // we re-raise so the UI shows it.
      const msg = (e?.message ?? "").toLowerCase();
      const looksLikePairing =
        msg.includes("authent") ||
        msg.includes("encrypt") ||
        msg.includes("paired") ||
        msg.includes("pairing");
      if (!looksLikePairing) {
        await device.cancelConnection().catch(() => undefined);
        throw bleErr("trigger pairing", err);
      }
      // Pairing was triggered but not completed yet — that's fine; the
      // user will see iOS's PIN prompt and the next characteristic
      // operation will succeed once they enter the PIN.
    }

    let rxSubscription: Subscription;
    try {
      rxSubscription = device.monitorCharacteristicForService(
        TITANIC_SERVICE,
        CHAR_LAST_RX,
        (err, chr) => {
          if (err) {
            // Only surface if it isn't the disconnect-induced cancellation.
            if ((err as BleError).errorCode !== 201 && this.rxCallback) {
              // No-op: we don't have a great place to surface this in
              // the current callback shape. The connection-state change
              // listener (below) will report the actual disconnect.
            }
            return;
          }
          if (!chr || !chr.value) return;
          const line = decodeBase64Ascii(chr.value);
          if (this.rxCallback && line) this.rxCallback(line);
        },
      );
    } catch (err) {
      await device.cancelConnection().catch(() => undefined);
      throw bleErr("subscribe RX", err);
    }

    // Read RSSI periodically. iOS only reports RSSI on demand. Poll
    // cadence sourced from .config.portwatch.yaml::ble.rssi_poll_ms —
    // 3s is the iOS smoothing-window sweet spot, but tweakable for
    // range-test use cases.
    let rssiTimer: ReturnType<typeof setInterval> | null = null;
    if (this.linkCallback) {
      rssiTimer = setInterval(async () => {
        try {
          const refreshed = await device.readRSSI();
          this.linkCallback?.(refreshed.rssi ?? null);
        } catch {
          this.linkCallback?.(null);
        }
      }, CFG.ble.rssi_poll_ms);
    }

    // Auto-clean on disconnect.
    const disconnectSub = this.manager.onDeviceDisconnected(
      device.id,
      () => {
        if (rssiTimer) clearInterval(rssiTimer);
        rxSubscription.remove();
        disconnectSub.remove();
        if (this.connected?.device.id === device.id) {
          this.connected = null;
        }
      },
    );

    this.connected = { device, rxSubscription };
    const name = device.localName || device.name || "Heltec";
    return { deviceName: name };
  }

  isConnected(): boolean {
    return this.connected !== null;
  }

  connectedDeviceName(): string | null {
    if (!this.connected) return null;
    return (
      this.connected.device.localName ||
      this.connected.device.name ||
      this.connected.device.id
    );
  }

  /** Write one Titanic Frame v2 ASCII line to the Heltec's Command char. */
  async writeFrame(line: string): Promise<void> {
    if (!this.connected) {
      throw new Error("not connected to a Heltec");
    }
    if (line.length > 250) {
      // Firmware buffer in titanic_ble.h is 250 chars hard-limit.
      throw new Error(`frame too long (${line.length} chars, max 250)`);
    }
    const b64 = encodeAsciiBase64(line);
    try {
      await this.connected.device.writeCharacteristicWithResponseForService(
        TITANIC_SERVICE,
        CHAR_CMD,
        b64,
      );
    } catch (err) {
      throw bleErr("write frame", err);
    }
  }

  /** Optional one-shot read of an integer characteristic, e.g. CHAR_RX_COUNT. */
  async readNumberChar(charUuid: string): Promise<number | null> {
    if (!this.connected) return null;
    try {
      const chr = await this.connected.device.readCharacteristicForService(
        TITANIC_SERVICE,
        charUuid,
      );
      if (!chr.value) return null;
      const ascii = decodeBase64Ascii(chr.value);
      const n = Number(ascii.trim());
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * One-shot read of an ASCII characteristic, e.g. CHAR_FW_VER. Returns
   * the trimmed string contents on success; null on any failure
   * (disconnected, missing characteristic, decode error). Used by the
   * Tests screen to dump firmware metadata into the Connectivity Probe.
   */
  async readStringChar(charUuid: string): Promise<string | null> {
    if (!this.connected) return null;
    try {
      const chr = await this.connected.device.readCharacteristicForService(
        TITANIC_SERVICE,
        charUuid,
      );
      if (!chr.value) return null;
      return decodeBase64Ascii(chr.value).trim();
    } catch {
      return null;
    }
  }

  /** Pull the firmware-side TX/RX/RSSI/SNR snapshot. */
  async readLinkStats(): Promise<{
    txCount: number | null;
    rxCount: number | null;
    rssi: number | null;
    snr: number | null;
  }> {
    if (!this.connected) {
      return { txCount: null, rxCount: null, rssi: null, snr: null };
    }
    const [tx, rx, rssi, snr] = await Promise.all([
      this.readNumberChar(CHAR_TX_COUNT),
      this.readNumberChar(CHAR_RX_COUNT),
      this.readNumberChar(CHAR_LAST_RSSI),
      this.readNumberChar(CHAR_LAST_SNR),
    ]);
    return { txCount: tx, rxCount: rx, rssi, snr };
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    const handles = this.connected;
    this.connected = null;
    handles.rxSubscription.remove();
    try {
      await handles.device.cancelConnection();
    } catch {
      // Already disconnected — fine.
    }
  }

  destroy(): void {
    this.stopScan();
    this.disconnect().catch(() => undefined);
    this.manager.destroy();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

// We deliberately avoid pulling in the `buffer` polyfill — Titanic
// frames are pure 7-bit ASCII so atob/btoa (always available in RN
// >= 0.71 / Hermes) are sufficient and one less dependency to ship.

function decodeBase64Ascii(b64: string): string {
  try {
    return globalThis.atob(b64);
  } catch {
    return "";
  }
}

function encodeAsciiBase64(ascii: string): string {
  // btoa accepts Latin-1; our frames are 7-bit ASCII so this is safe.
  return globalThis.btoa(ascii);
}

function bleErr(op: string, err: unknown): Error {
  const e = err as BleError;
  const msg = e?.message ?? String(err);
  return new Error(`BLE ${op} failed: ${msg}`);
}
