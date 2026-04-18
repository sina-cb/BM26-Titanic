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
