# MIDI Discovery

Self-serve tool to capture **everything a MIDI controller sends** and export a
JSON file that a coordinator agent later reads from the repo to author a
CaptainPad controller profile.

Node has no built-in MIDI and the codex forbids native midi packages, so the
capture runs in the browser via the **Web MIDI API** (the same API CaptainPad
uses). This directory is just:

- `serve.cjs` — tiny dependency-free HTTP server (port **6979**) that serves the
  page and receives the exported JSON.
- `index.html` + `discovery.js` — the discovery UI (no frameworks, no CDNs).
- `captures/` — where exported JSON lands (created on first save).

## Run it

```bash
cd marsin_engine
node tools/midi_discovery/serve.cjs        # → http://127.0.0.1:6979
# optional: node tools/midi_discovery/serve.cjs --port 6980
```

Then open **http://127.0.0.1:6979** in **Chrome or Edge** (Web MIDI is not
supported in Firefox/Safari, and only works over `http://127.0.0.1`/`localhost`
or `https`). Port 6979 is deliberately outside the dev stack's range
(6967-6972), so this can run alongside the sim/engine/CaptainPad.

## Workflow

1. **Request MIDI access.** Click *Request MIDI access (sysex)* and allow it.
   Grant **sysex** — the Intech Grid's config/screen dumps ride on sysex, and
   capturing them matters. If you deny sysex the tool falls back to non-sysex
   **with a visible warning** and sysex traffic will NOT be captured.
2. **Pick inputs.** Every MIDI in/out is listed with manufacturer + name + id.
   By default all inputs are captured except the Midi Fighter Twister and APC
   (already-known controllers) — toggle any checkbox to change that.
3. **Labeled capture — the important part.** Type a label describing one
   control *and one gesture*, click *Start labeled capture*, perform the
   gesture on the controller, then *Stop* (or let it auto-stop after 2s of
   silence — configurable). **Label every control and every gesture type**, e.g.:
   - `encoder 1 turn CW slow`, `encoder 1 turn CW fast`, `encoder 1 turn CCW`
   - `encoder 1 press`, `encoder 1 release`
   - `button 5 press`, `button 5 release`
   - `fader A full sweep`
   Repeat per control. The running list shows a per-group message summary.
4. **Watch the live monitor + auto-summary.** Every message is logged with
   timestamp, port, raw hex, and a decoded view (type / channel / number /
   value; full hex for sysex). The auto-summary aggregates each
   `(port, type, channel, number)` tuple: count, value range, first/last seen,
   and which labels it appeared in — that table is what the profile is authored
   from.
5. **Export.** Click *Export & save to repo*. The server writes the JSON into
   `captures/<safe-device-name>_<yyyymmdd_hhmmss>.json` and shows the saved
   path. *Download JSON* is a fallback if the POST fails.

There's also a **Send test** panel: pick an output port and send a CC / note /
sysex hex string to probe whether the Grid reacts (LEDs, screen) to incoming
MIDI.

## Capture JSON shape

```jsonc
{
  "tool": "midi_discovery",
  "version": 1,
  "exportedAt": "2026-07-08T12:00:00.000Z",   // page clock, ISO-8601
  "device": {
    "name": "Intech Grid MIDI device",
    "ports": [
      { "direction": "input",  "id": "...", "name": "...",
        "manufacturer": "...", "capturing": true },
      { "direction": "output", "id": "...", "name": "...", "manufacturer": "..." }
    ]
  },
  "labels": [
    { "label": "encoder 1 turn CW slow", "startMs": 1234.5, "endMs": 3210.0,
      "messages": [ { "t": 1250.1, "port": "...", "portId": "...",
                      "bytes": [176,12,64], "hex": "B0 0C 40",
                      "type": "cc", "channel": 0, "number": 12, "value": 64 } ] }
  ],
  "rawLog":  [ /* every message, same shape as messages above, in order */ ],
  "summary": [
    { "port": "...", "type": "cc", "channel": 0, "number": 12, "count": 14,
      "valueMin": 63, "valueMax": 65, "firstMs": 1250.1, "lastMs": 3200.4,
      "labels": ["encoder 1 turn CW slow"] }
  ]
}
```

`timestamps` are `performance.now()` milliseconds (monotonic, page-relative).
The **capture JSON is the input for CaptainPad profile authoring** — commit it.

## Captures are committed (not gitignored)

The exported JSON is the **deliverable** of a discovery session, so `captures/`
is intentionally **not** gitignored (unlike `.agent_renders/` or the gallery's
scratch `widgets/`, which are regenerable review artifacts). Commit the capture
you want the coordinator to author a profile from.

## Verify (dev)

```bash
cd marsin_engine
node --check tools/midi_discovery/serve.cjs
node --test  tools/midi_discovery/serve.test.mjs
```

The tests bind an **ephemeral** port (`0`), never 6979. Live browser capture is
verified by the operator running the page.
