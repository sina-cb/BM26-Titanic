# Auto-Patcher Specification & Usage Guide

The `auto_patcher.js` module in the BM26-Titanic simulation automates the assignment of DMX addresses and critical metadata (`sectionId`, `controllerId`, `fixtureId`) across the lighting rig.

## Usage Instructions

1. **Accessing the Patcher**: In the simulation GUI, navigate to the **ParLights** folder.
2. **Auto-Patching**: Click the `🎯 Auto-Patch All Unpatched` button. 
   - This process operates non-destructively on existing patches by default. Only fixtures with an address of `0` will receive new DMX addresses.
   - However, **metadata fields** (`sectionId`, `controllerId`, `fixtureId`) are dynamically evaluated and assigned for *all* fixtures, ensuring new groups are properly recognized even if DMX addresses were manually set.
3. **Clearing Metadata**: If you need to reset groups or controller groupings without losing DMX patches, click `🔄 Clear Metadata`.
4. **Clearing Patches**: To completely wipe the slate clean, click `❌ Clear All Patches`.

## Expected Behavior & Assignment Rules

### 1. DMX Address Generation
The auto-patcher operates in two distinct passes:
- **Pass 1: Global Effects (Fixed Mapping)**: Global effects (Foggers, Hazers) are forcefully pinned to **Universe 1**. They are mapped backwards starting from the highest available address (e.g., 512, 511) to isolate them from standard lighting data.
- **Pass 2: Lighting Fixtures (Dynamic Packing)**: Standard lighting fixtures are packed continuously, starting from **Universe 2**. The patcher uses a First-Fit algorithm, automatically rolling over to the next universe when a fixture's footprint exceeds the remaining space.

### 2. Metadata Assignment
The patcher automatically extracts data from the fixture configurations to generate routing IDs:

- **`sectionId` (Dimmer Groups)**: 
  The patcher looks at the `group` property of each fixture (e.g., `ParLights`, `BarLights`). It assigns a unique, monotonic integer (`1`, `2`, `3`...) to each unique group name. All fixtures sharing the same group name will receive the same `sectionId`. This is critical for the Dimmer Rack (see below).
- **`controllerId`**:
  The patcher looks at the `controllerIp` property. It assigns a unique integer to each unique IP address, grouping fixtures by their physical hardware receiver.
- **`fixtureId`**:
  A simple, monotonically increasing integer assigned to every fixture in the rig for unique absolute identification.

## Dimmer Rack Integration

The assignment of the `sectionId` is what powers the **Dimmer Rack** in the CaptainPad mobile application. 

1. **Model Baking**: When you export the simulation (`patches.yaml` and `model.js`), the `sectionId` values are baked into the `model.js` file for the Marsin Engine.
2. **Engine Parsing**: The Marsin Engine reads the model, groups all pixels by their `sId` (sectionId), and exposes these dynamic groups over the `/dimmer-groups` API endpoint.
3. **Dynamic UI Generation**: CaptainPad fetches these groups on load. For every unique `sectionId` discovered, the app dynamically generates a `NauticalFader` slider labeled with the group's name.
4. **Independent Control**: When a fader is adjusted, CaptainPad sends an intensity multiplier for that specific `sectionId` to the engine. The engine scales the final output for only those specific pixels, allowing you to independently dim or boost the `ParLights` group relative to the `BarLights` group.
