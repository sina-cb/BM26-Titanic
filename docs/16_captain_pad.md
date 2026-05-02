# CaptainPad 6969
**iPad Application Design & Architecture**

The CaptainPad is the primary control surface for the BM26-Titanic interactive LED installation. It bridges the gap between the MarsinEngine backend (pattern compilation & sACN routing) and the physical lights.

## 1. iPad Core UX / UI Principles

To follow best practices for iOS/iPadOS "Pro" applications (such as Logic Pro, LumaFusion, or professional lighting consoles like GrandMA):

1. **Navigation Rail (Left Sidebar):** Instead of a mobile-style bottom tab bar, iPad apps benefit greatly from a persistent left-side navigation rail. This maximizes vertical space for code editors and WebGL views.
2. **Split-Pane Architecture (Master-Detail):** Essential for an iPad. The left pane should contain lists (e.g., list of patterns, list of parameters), and the right pane should contain the active workspace (the code editor, the actual sliders).
3. **High-Tactility For Live Performance:** Button hit-boxes must be large. During a burn/event, it is dark and dusty; controls must be unambiguous. Accidental touches on critical buttons (like "Delete Pattern" or "Blackout") should require confirmation or be visually separated.
4. **Persistent System Status:** A thin bar at the top or bottom that always shows `Engine Status`, `FPS`, `Network Ping`, and `Active Scene`.

---

## 2. The Navigation Structure (Tabs)

### 🎛️ Tab 1: The Control Deck (Live Performance)
*The primary screen to be left open during the event.*
* **Left Pane (Pattern Queue):** A scrollable list of all available Pixelblaze patterns fetched from the server. Tapping one instantly sends a command to switch the engine's active pattern.
* **Right Pane (Parameters & Macros):**
  * Dynamic sliders for the active pattern (Global Speed, Hue Shift, Intensity).
  * Quick-trigger Macro pads (e.g., "Trigger Burst", "Strobe").
  * A massive, easily accessible **Global Blackout** toggle.

### 💻 Tab 2: The Studio (Pattern Editor)
*For making adjustments and writing logic on the fly.*
* **Left Pane (File Explorer):** List of patterns (fetched via `GET /list-patterns`). Has an 'Add New' button.
* **Right Pane (Code Editor):** 
  * A `react-native-webview` encapsulating a `Monaco` code editor, or a robust React Native text area.
  * A floating **"Save & Compile"** button (`POST /save-pattern`) which pushes the code to the engine instantly to see the results.

### 👁️ Tab 3: The Monitor (Simulation Web Viewer)
*For visualizing the ship when away from the physical installation.*
* **Full Screen Layout:** Embeds the Three.js WebGL simulation using `react-native-webview`. 
* **Overlay Controls:** Transparent overlay buttons for "Refresh View" (in case the WebGL context drops) or viewing different camera angles defined in `cameras.yaml`.

### 🛠️ Tab 4: System Health & Swarm Data
*Crucial for Burning Man installations to diagnose hardware failures.*
* **Dashboard Widgets:**
  * **MarsinEngine Metrics:** Current FPS, memory usage, current sACN routing.
  * **Swarm Status:** A list tracking the status of all ESP32 controllers and SHEHDS fixtures based on data from `sacn_bridge.js`.
  * **Event Log:** A trailing console output showing realtime errors or connections (subscribes to `sacn_bridge` WebSockets).

### ⚙️ Tab 5: Settings & Config
* *Environment Variables:* Input fields to set the IP address of the `marsin_engine` server and `save_server`. 
* *Theme Toggle:* Toggle between Dark Mode (Stage Mode) and the "White Modern" designer aesthetic for daytime visibility.
* *DMX Patch Interface:* (Optional) Easy UI to modify `patches.yaml` dynamically if a controller breaks and needs to be swapped out on the playa.

---

## 3. Communication Strategy

1. **HTTP REST (`save-server.js`):** 
   * `GET /list-patterns`
   * `POST /save-pattern`
2. **WebSocket / Socket.io (To be built into `marsin_engine`):**
   * Emits live FPS telemetry and logs to Tab 4.
   * Receives real-time JSON packets from the parameter sliders in Tab 1 without HTTP overhead.

---

## 4. Server Discovery & Connection Health

The CaptainPad must operate on unpredictable local networks (Burning Man, different WiFi setups, DHCP) where the MarsinEngine's IP address is not known in advance.

### 4.1 Server Identity Contract

MarsinEngine's `GET /status` endpoint returns a service identity marker:

```json
{
  "service": "marsin-engine",
  "name": "MarsinEngine",
  "version": "2.0",
  "port": 6968,
  "activeModel": "titanic",
  "activePattern": "rainbow",
  "activeScene": "titanic",
  "unrealState": "offline"
}
```

The `service` field prevents CaptainPad from accepting any random HTTP server on port 6968 during network scanning.

### 4.2 HTTP Subnet Scan (Primary Discovery)

CaptainPad discovers MarsinEngine instances via HTTP subnet scanning:

1. **Get device IP** via `expo-network` → `getIpAddressAsync()`
2. **Derive `/24` subnet** (e.g., `10.1.1.42` → `10.1.1.1..254`)
3. **Batch probe** each candidate IP on port 6968 with `GET /status` (400–800ms timeout, 24–40 concurrent)
4. **Filter** responses: only accept `service === "marsin-engine"`
5. **Display** discovered servers as tappable cards in Config tab

This approach requires no native mDNS dependencies, works on any network topology, and is compatible with Expo's managed workflow.

### 4.3 Connection Health

A shared connection-status context polls `/status` every 5 seconds and exposes:
- `isConnected` (boolean) — drives green/red sidebar indicator
- `latencyMs` — displayed in Config tab
- `serverInfo` — active pattern, model, scene
- `error` — surfaced in OFFLINE banners across all tabs

### 4.4 Manual Fallback

The Config tab retains a manual URL text input as a fallback for non-standard networks or when subnet scanning is impractical.

---

## 5. Standalone Deployment (iPadOS 17+)

### 5.1 Build Pipeline

CaptainPad is deployed as a standalone `.ipa` via EAS Build (`preview` profile). No Expo Go or development server required.

```bash
eas build --platform ios --profile preview --clear-cache
```

### 5.2 iOS ATS Configuration

iPadOS 17+ no longer allows ATS connections to IP addresses by default. The app requires:

- `NSAllowsLocalNetworking: true` — enables local network IP access
- `NSAllowsArbitraryLoads: true` — backward compat for older iOS
- `NSAllowsArbitraryLoadsInWebContent: true` — WebView HTTP for Monitor tab
- `NSExceptionDomains` with universal CIDR ranges (`0.0.0.0/0`, `::/0`)
- `NSLocalNetworkUsageDescription` — user-facing permission prompt string
- `NSBonjourServices: ["_marsinengine._tcp"]` — future-proofs local network prompt

### 5.3 Local Network Permission

On first launch, iOS shows a Local Network permission dialog. If denied, all local network traffic fails silently. The Config tab includes user guidance and a deep-link to iPad Settings.

See full implementation details: `.agent/02_reports/202605/20260502_1_standalone_ipad.md`
