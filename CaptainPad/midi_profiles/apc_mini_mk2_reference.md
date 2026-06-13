# APC mini mk2 — MIDI In/Out Reference

Authoritative summary distilled from Akai's **APC mini mk2 Communications
Protocol v1.0** and **APC mini User Guide v1.0** (both archived in
[`manuals/`](manuals/)), cross-checked against a live Web MIDI capture on the
dev PC (2026-06-12). This is the source of truth for
[`apc_mini_mk2.yaml`](apc_mini_mk2.yaml) and the LED projector.

> **Hardware:** USB bus-powered. 8×8 RGB pad grid, 9 faders, 17 single-colour
> UI buttons. Class-compliant — no driver.

## Endpoints (as Chromium Web MIDI reports them on Windows)

| Kind | Port | Name reported | Manufacturer |
|---|---|---|---|
| input  | 0 | `APC mini mk2`            | AKAI Professional |
| input  | 1 | `MIDIIN2 (APC mini mk2)`  | AKAI Professional |
| output | 0 | `APC mini mk2`            | AKAI Professional |
| output | 1 | `MIDIOUT2 (APC mini mk2)` | AKAI Professional |

- **Port 0** carries Session/Drum-mode pad notes, all faders, all UI buttons,
  and **all LED feedback** — this is the only port we use.
- **Port 1** (`MIDIIN2`/`MIDIOUT2`) is the device's *Note Mode* surface; unused.
- `nameContains: "APC mini mk2"` matches **both** port-0 and port-1 names, so the
  profile MUST also pin `sourcePort: 0` / `destinationPort: 0` to disambiguate.
  Bome virtual ports (`APCMini -> …`, mfr "Microsoft") do not contain the string
  and are correctly excluded.

---

## INBOUND — messages the controller SENDS (device → host), Port 0, Channel 0

| Control | Type | Number (hex) | Number (dec) | Value |
|---|---|---|---|---|
| **Clip/grid pads** (8×8) | Note On / Note Off | `0x00`–`0x3F` | **0–63** | velocity 127 on press, Note Off (or vel 0) on release |
| **Track buttons 1–8** (row under grid) | Note On / Note Off | `0x64`–`0x6B` | **100–107** | 127 / 0 |
| **Scene Launch 1–8** (right column) | Note On / Note Off | `0x70`–`0x77` | **112–119** | 127 / 0 |
| **Shift** (bottom-right) | Note On / Note Off | `0x7A` | **122** | 127 / 0 |
| **Faders 1–8** (channel) | Control Change | `0x30`–`0x37` | **48–55** | absolute 0–127 |
| **Fader 9** (master) | Control Change | `0x38` | **56** | absolute 0–127 |

**Grid note layout** (Session View, standard Akai orientation — origin
bottom-left, left→right within a row, rows bottom→top):

```
row (top)   56 57 58 59 60 61 62 63
            48 49 50 51 52 53 54 55
            40 41 42 43 44 45 46 47
            32 33 34 35 36 37 38 39
            24 25 26 27 28 29 30 31
            16 17 18 19 20 21 22 23
             8  9 10 11 12 13 14 15
row (btm)    0  1  2  3  4  5  6  7
```

(Orientation confirmed in HITL via the LED diagonal test — notes 0,9,18,…,63.)

---

## OUTBOUND — messages the host SENDS to set LEDs (host → device), Port 0

### RGB grid pads (`0x00`–`0x3F`): `9c nn vv`
3-byte Note On where the **MIDI channel selects behaviour/brightness**, note =
pad value, **velocity = colour** (fixed 128-entry palette).

| Channel | Status byte | Behaviour |
|---|---|---|
| 0 | `0x90` | Solid 10% |
| 1 | `0x91` | Solid 25% |
| 2 | `0x92` | Solid 50% |
| 3 | `0x93` | Solid 65% |
| 4 | `0x94` | Solid 75% |
| 5 | `0x95` | Solid 90% |
| 6 | **`0x96`** | **Solid 100%** ← default for our feedback |
| 7–10 | `0x97`–`0x9A` | Pulsing 1/16, 1/8, 1/4, 1/2 |
| 11–15 | `0x9B`–`0x9F` | Blinking 1/24, 1/16, 1/8, 1/4, 1/2 |

Example: `96 00 05` = pad 0 solid-100% **red**.

### Single-colour UI buttons (Track `0x64`–`0x6B` = red, Scene `0x70`–`0x77` = green): `90 nn vv`
Always MIDI channel 0 (`0x90`); RGB behaviour channels do **not** apply.

| Velocity | Meaning |
|---|---|
| `0x00` | Off |
| `0x01`, `0x03`–`0x7F` | On |
| `0x02` | Blink |

- **Shift (`0x7A`) has no LED.**

### Colour palette (velocity → RGB) — common entries
| vel | colour | vel | colour | vel | colour |
|---|---|---|---|---|---|
| 0 | off / black | 5 | red `#FF0000` | 21 | green `#00FF00` |
| 1 | dim grey `#1E1E1E` | 9 | orange `#FF5400` | 45 | blue `#0000FF` |
| 3 | white `#FFFFFF` | 13 | yellow `#FFFF00` | 78 | cyan `#00A9FF` |

Full 128-entry chart is in the protocol PDF (p.4–5). The palette is fixed and
cannot be remapped over MIDI (SysEx allows true-RGB, but we stay on plain
3-byte messages — no SysEx, no permission prompt).

---

## Notes for the mapping layer

- All runtime traffic is plain 3-byte channel messages — no SysEx needed for
  input, LED feedback, or our use case.
- Optional niceties the protocol also exposes (not used in v1): MMC Device
  Enquiry, Introduction handshake (device replies with all 9 fader positions —
  handy for seeding fader state on connect), and SysEx true-RGB lighting.
- Faders send **absolute** position, so a coalesced ~30 Hz trailing throttle is
  the right shape (latest value wins, flush the final value).
