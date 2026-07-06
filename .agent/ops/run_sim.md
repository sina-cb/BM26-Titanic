# 06. Run Simulation

This spec defines how to properly launch and maintain the 3D lighting simulation for the Titanic at Burning Man 2026. The playa has no reliable internet, so the deployment target is strict offline readiness. As of 2026-05-08, the live `simulation/index.html` still references external CDN/font URLs; treat that as an offline-readiness blocker until those assets are vendored and the import map is local.

## How to Start the Simulation

To launch the simulation and its background services:

```bash
cd simulation
npm start
```

This launches:
- **HTTP Server** (port `6969`): Serves the Three.js 3D environment and GUI.
- **Save Server** (port `6970`): Persists `scene_config.yaml` state.
- **sACN Input Bridge** (port `6971`): Receives sACN from `marsin_engine` over WebSocket.
- **sACN Output Bridge** (port `6972`): Outputs sACN to real controllers.

## Offline Readiness Requirements

1. **No CDNs or External Resources Before Playa Deployment:** The target state is local `importmap` resolutions only. Before claiming offline readiness, verify `simulation/index.html` has no `https://` runtime imports for Three.js, Chroma.js, fonts, CSS, or other browser assets.
2. **Pre-installed Dependencies:** Ensure `npm install` is executed before deployment. No `npm install` steps should be required during runtime, strike, or setup on the playa.
3. **Local IP Routing:** DMX patching and sACN routing must rely purely on local subnet IPs (e.g., `10.1.1.x`) or Tailscale IPs. Do not rely on external DNS resolution.
4. **Standalone Start:** The `start.js` orchestrator must successfully spin up all local endpoints independently of any cloud service.
5. **No Telemetry/Analytics:** Ensure no tools, plugins, or linters attempt to phone home during execution.

## Health Checks

- Verify `http://localhost:6969/simulation/` loads without a white screen or permanent loading overlay (which often indicates a hanging external network request).
- Check that the `📡 sACN Monitor` panel registers incoming traffic when `marsin_engine` is running on the local loopback.
- Ensure the DMX Fixture generation correctly maps to local offline models.
