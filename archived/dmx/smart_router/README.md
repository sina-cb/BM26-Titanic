# sACN Smart Priority Router

A Node.js mediation layer that intelligently routes sACN (E1.31) traffic to the physical lighting hardware. It solves the issue where some physical DMX nodes (like the PKnight) incorrectly merge traffic from multiple sources using HTP (Highest Takes Precedence) rather than respecting sACN Priority.

## Why do we need this?

If you run the **Node.js Testbench** (Priority 100) and **Chromatik LX Studio** (Priority 150) simultaneously against the physical controller, the hardware blends their channels together. This router intercepts their output locally, respects the priority rules in software, and forwards a single, clean sACN stream to the hardware.

## How it works

1. The smart router listens on `127.0.0.1` (localhost) Universe 1.
2. It detects traffic from **low priority** (testbench, typically `100`) and **high priority** (LX Studio, typically `150`) sources.
3. If high priority data is detected, it **immediately locks out** all low-priority data.
4. The lockout persists for **10 seconds** after the high-priority source stops sending data, guaranteeing a smooth handoff without flickering back and forth.
5. The winning stream is forwarded unicast to the PKnight hardware node (`10.1.1.102`).

## Setup

1. **Testbench**: `dmx/universes.yaml` is already configured to point the `test_bench` universe to `127.0.0.1`.
2. **LX Studio**: In your Chromatik LX output settings, set the sACN output destination to `127.0.0.1` (Unicast) or default multicast. Ensure priority is set to `150`.

## Installation & Usage

From the `dmx` directory:

```bash
# Launch the smart router
npm run router

# Launch with debug mode
npm run router:debug

# Launch the test bench in a separate terminal
npm run testbench
```

## Debugging

If you are not seeing the expected output or need to deeply inspect the sACN traffic, you can enable verbose packet logging.

Open `dmx/smart_router/sacn_smart_router.js` and change `const DEBUG_PAYLOAD = process.env.DEBUG_PAYLOAD === 'true';` to simply `const DEBUG_PAYLOAD = true;`.

Alternatively, launch the router with the environment variable set:

**Windows PowerShell:**
```powershell
$env:DEBUG_PAYLOAD="true"; npm run router
```

**Linux/Mac:**
```bash
DEBUG_PAYLOAD=true npm run router
```

When enabled, the router will output the raw payload structure and the exact values of any non-zero channels it receives every second.
