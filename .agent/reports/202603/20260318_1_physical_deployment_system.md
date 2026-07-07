# Physical Deployment System Design — 2026-03-18
**Project:** BM26-Titanic Lighting Installation  
**Status:** Pre-Deployment Planning  
**Scope:** Full system wiring, power, control, network, and hardware for physical playa deployment

---

## System Overview

The TITANIC lighting system spans a ~200' × 50' sculpture footprint plus 4 satellite iceberg stations. The installation is organized as **two mirrored sides** (port and starboard), each with its own sealed control box, connected by a central Ethernet network to a single control computer. All controllers — DMX interfaces, pixel controllers, and projection mapping inputs — receive **ArtNet data simultaneously** from the main machine over the network.

### Subsystem Summary

| Subsystem | Count | Type | Controller | Protocol | Power |
|-----------|-------|------|-----------|----------|-------|
| Par Lights (DMX) | ~130 fixtures | RGBW LED pars (50-100W) | ArtNet → DMX nodes | ArtNet over Ethernet | Groups of 5, PowerCon daisy-chain |
| LED Strands | Many (TBD) | Addressable RGB (WS2812B/SK6812) | **Chroma.tech Angio 8** | ArtNet over Ethernet | 5V PSU in sealed control box |
| Iceberg Floods | 4 | Industrial light towers | Standalone or DMX | ArtNet (optional) | Self-powered (diesel) |
| Iceberg LED Art | 4 sets | Addressable LED edge art | **Chroma.tech Angio 8** | ArtNet over Ethernet | 5V PSU |
| Smokestack Rings | 4-8 | Addressable LED rings | **Chroma.tech Angio 8** | ArtNet over Ethernet | 5V PSU |
| Projection Mapping | External team | Projector(s) | External laptop | **ArtNet / NDI input** | External |

---

## 1. Network Architecture — The Backbone

> [!IMPORTANT]
> **Everything is on the network.** One control computer runs Chromatik and sends ArtNet data to all controllers simultaneously. No standalone WiFi controllers — all pixel controllers and DMX interfaces are wired Ethernet.

### Network Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MAIN CONTROL COMPUTER                               │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────────┐│
│  │  Chromatik    │  │  Three.js    │  │  NDI Bridge (future)          ││
│  │  (ArtNet out) │  │  Simulation  │  │  (Sim ↔ Chromatik preview)   ││
│  └──────┬───────┘  └──────────────┘  └────────────────────────────────┘│
│         │                                                               │
│         │  ArtNet (UDP broadcast / unicast)                              │
│         │                                                               │
└─────────┼───────────────────────────────────────────────────────────────┘
          │
          │  Ethernet (single cable to switch)
          │
┌─────────▼────────────────────────────────────────────────────────────────┐
│                MAIN ETHERNET SWITCH (Playa Tent / Central Location)      │
│                                                                          │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│   │Port Box  │  │Stbd Box  │  │Iceberg   │  │Projection│  │Stack     ││
│   │(Sealed)  │  │(Sealed)  │  │Boxes     │  │Mapping   │  │Rings     ││
│   │          │  │          │  │(×4)      │  │(External)│  │(×4)      ││
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘│
│                                                                          │
│   All devices receive ArtNet simultaneously from the main computer       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key Network Principles
- **Single source of truth:** The control computer sends ArtNet to ALL controllers
- **Two-side symmetry:** Port and starboard sides are mirror-image systems, each with its own sealed control box, both synced by receiving the same ArtNet data from the same machine
- **Wired, not wireless:** All controllers are Ethernet-connected for reliability (no WiFi dropouts on playa)
- **Projection mapping port:** External projection mapping team plugs their laptop into the same switch and receives ArtNet data (or sends NDI) to coordinate with the lighting

### ArtNet Universe Map

| Universe | Assignment | Controller | Location |
|----------|-----------|-----------|----------|
| 1 | Par lights — Port side | ArtNet→DMX node (Port box) | Port sealed box |
| 2 | Par lights — Starboard side | ArtNet→DMX node (Stbd box) | Stbd sealed box |
| 3 | LED strands — Port hull | Chroma.tech Angio 8 (Port box) | Port sealed box |
| 4 | LED strands — Starboard hull | Chroma.tech Angio 8 (Stbd box) | Stbd sealed box |
| 5 | Iceberg LED art (all 4) | Chroma.tech Angio 8 (Iceberg boxes) | Per-iceberg |
| 6 | Smokestack rings (all 4-8) | Chroma.tech Angio 8 | At stack base |
| 7 | Iceberg floods (DMX dimming) | ArtNet→DMX node | Optional |
| 8-10 | Projection mapping / expansion | Reserved for external team | Switch port |

---

## 2. Sealed Control Boxes — Per Side

Each side of the ship gets an **identical, sealed weather-resistant control box** (IP65 enclosure from Amazon). These boxes contain all the electronics for that side — pixel controllers, DMX interfaces, Ethernet switch, and power supplies.

### Box Contents (Per Side)

| Component | Model | Function | Qty |
|-----------|-------|----------|-----|
| Sealed enclosure | IP65 NEMA box (Amazon) | Dust/rain protection | 1 |
| Ethernet switch (small) | 5-8 port unmanaged | Local network distribution | 1 |
| **Chroma.tech Angio 8** | 8-output ArtNet pixel controller | Drives all LED strands on this side | 1 |
| ArtNet→DMX node | e.g., DMXking eDMX2 PRO | Converts ArtNet to DMX 5-pin XLR | 1 |
| Meanwell 5V PSU | LRS-350-5 (5V 60A) | Powers Angio 8 + LED strips | 1-2 |
| DIN rail / mounting plate | — | Internal organization | 1 |
| Cable glands | IP68 rated | Sealed cable entry points | 8-12 |

### Wiring Inside Each Box

```
Ethernet in (from main switch) ──→ Local 5-port switch
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
              Chroma.tech          ArtNet→DMX          (spare port
              Angio 8              Node                 for debug
              (ArtNet in)          (ArtNet in)          laptop)
                    │                   │
                    ▼                   ▼
              8 × LED strip        DMX 5-pin XLR out
              outputs              to par chain
              (Phoenix term.)      (groups of 5)
                    │
                    ▼
AC Mains in ──→ 5V PSU ──→ Powers Angio 8 + LED strips
              (inside box)
```

### Physical Placement
- **Port box:** Mounted at base of port hull, near center break point
- **Starboard box:** Mirror position on opposite side
- **Cable entry:** All cables (Ethernet, AC power, DMX out, LED strip data+power) enter through IP68 cable glands
- **Ventilation:** Passive vent with filter, or small fan if heat buildup is a concern

---

## 3. Par Lights (DMX Fixtures) — Groups of 5

### Grouping
Par lights are wired in **groups of 5 fixtures**, each group daisy-chained for both power (PowerCon) and data (DMX 5-pin XLR).

### Power Per Group

| Fixture Wattage | Group of 5 Watts | Max Groups Per 20A Circuit | Notes |
|-----------------|-------------------|----------------------------|-------|
| 50W | 250W | 8 groups (40 pars) | ✅ **Recommended** |
| 100W | 500W | 4 groups (20 pars) | Viable |
| 200W | 1000W | 1.5 groups (7 pars) | ❌ Avoid — too few per circuit |

### Wiring Per Group

```
PowerCon trunk cable (from distro) ──→ Par 1 ──→ Par 2 ──→ Par 3 ──→ Par 4 ──→ Par 5
DMX cable (from ArtNet→DMX node)   ──→ Par 1 ──→ Par 2 ──→ Par 3 ──→ Par 4 ──→ Par 5 ──→ [TERM]
                                                                                            120Ω
```

### DMX Addressing Per Group
Each par runs in 4ch RGBW mode:
- Group 1: addresses 1-20 (5 × 4ch)
- Group 2: addresses 21-40
- Group 3: addresses 41-60
- ...and so on through ~26 groups (130 pars)

### Physical Layout

| Ship Section | Side | Groups of 5 | Total Pars | DMX Universe |
|-------------|------|-------------|------------|--------------|
| Front Wall | Port | 4 groups | 20 | Universe 1 |
| Front Deck | Port | 1 group | 5 | Universe 1 |
| Center Auditorium | Port | 1-2 groups | 5-10 | Universe 1 |
| Back Wall | Port | 4 groups | 19-20 | Universe 1 |
| Front Wall | Stbd | 4 groups | 20 | Universe 2 |
| Front Deck | Stbd | 1 group | 5 | Universe 2 |
| Center Auditorium | Stbd | 1-2 groups | 5-10 | Universe 2 |
| Back Wall | Stbd | 4 groups | 20 | Universe 2 |
| Chimney Rings (par) | Both | 2 groups (circles) | 9 each | Universe 1+2 |

### Power Wiring to Par Groups

```
Generator → Cam-Lock Distro Panel
                │
    ┌───────────┼──────────────────────────────────┐
    │           │                                  │
 20A Breaker  20A Breaker                     20A Breaker
    │           │                                  │
    ▼           ▼                                  ▼
 PowerCon    PowerCon                          PowerCon
 trunk to    trunk to                          trunk to
 Port Fwd    Port Aft                          Stbd groups
 Groups 1-4  Groups 5-8                        ...
 (20 pars)   (20 pars)
```

Each **PowerCon trunk cable** runs from the distro panel to the first par in the group chain (15-30m depending on section), then short 1m PowerCon jumpers between fixtures within the group.

---

## 4. LED Strands — Chroma.tech Angio 8 Controllers

### Controller: Chroma.tech Angio 8
- **8 powered pixel outputs** per unit (Phoenix screw terminals)
- **ArtNet input** via Ethernet — receives data from the main computer
- **Voltage range:** 5V-24V (supports WS2812B at 5V or WS2815 at 12V)
- **Max power input:** 12A per power input (2 inputs, each driving 4 channels)
- **FCC certified**, reliable, purpose-built for large LED installations

### Per-Side LED Architecture

Each sealed control box contains **1 × Chroma.tech Angio 8** with **8 outputs** available for LED strands on that side:

| Output | Strand Assignment | Approx. LED Count | Location |
|--------|------------------|-------------------|----------|
| CH 1 | Hull Strand - Forward Upper | 100-150 LEDs | Port/Stbd bow area |
| CH 2 | Hull Strand - Forward Lower | 100-150 LEDs | Port/Stbd bow area |
| CH 3 | Hull Strand - Center Upper | 100-150 LEDs | Port/Stbd midship |
| CH 4 | Hull Strand - Center Lower | 100-150 LEDs | Port/Stbd midship |
| CH 5 | Hull Strand - Aft Upper | 100-150 LEDs | Port/Stbd stern area |
| CH 6 | Hull Strand - Aft Lower | 100-150 LEDs | Port/Stbd stern area |
| CH 7 | Interior / Deck strands | 100-200 LEDs | Interior spaces |
| CH 8 | Spare / expansion | — | — |

**Total per side:** ~700-1,100 addressable LEDs across 7-8 strands  
**Total both sides:** ~1,400-2,200 addressable LEDs

### Power for LED Strands

```
AC Mains → Meanwell 5V 60A PSU (inside sealed box) → Angio 8 power inputs
                                                           │
                                          ┌────────────────┼────────────────┐
                                          │                │                │
                                      CH1-CH4 (Input A)  CH5-CH8 (Input B)
                                      12A max combined   12A max combined
                                          │                │
                                          ▼                ▼
                                    LED strips exit    LED strips exit
                                    box via cable      box via cable
                                    glands             glands
```

> [!CAUTION]
> **Power injection still required** for long strip runs. The Angio 8 provides initial power, but strips over ~150 LEDs at 5V need additional 5V injection taps along the run. Route 16-18 AWG power injection wires from the PSU alongside the data lines.

---

## 5. Projection Mapping Interface — Network Tie-In

### How External Projection Mapping Integrates

The projection mapping team is an **external crew** with their own laptop and projector(s). They need to tie into the ship's lighting network so their projections can be coordinated with (or driven by) the same data that controls all other lighting.

### Integration Point

```
Main Ethernet Switch
    │
    ├── Port Box (ArtNet)
    ├── Stbd Box (ArtNet)
    ├── Iceberg Boxes (ArtNet)
    ├── Stack Ring Controllers (ArtNet)
    │
    └── ★ PROJECTION MAPPING PORT ★
        │
        └── External laptop plugs in here
            │
            ├── Option A: Receives ArtNet universes 8-10
            │              (Chromatik sends mapped pixel data
            │               that the projection SW uses as input)
            │
            ├── Option B: Sends NDI video feed to control computer
            │              (projection content visible in Chromatik/sim)
            │
            └── Option C: Receives timecode/trigger signals
                           (external SW syncs to master clock)
```

### What the Projection Team Needs From Us
1. **An Ethernet port** on the main switch (reserved, labeled "PROJECTION")
2. **ArtNet universe assignment** (universes 8-10 reserved for their use)
3. **Network config sheet:** IP range, subnet, ArtNet universe numbers
4. **Optional: NDI source** from our control computer for content sync
5. **Optional: Timecode feed** if they want to sync to our pattern scheduler

### What We Need From Them
1. Their laptop must be on the **same subnet** (static IP in our range)
2. They must **not broadcast** on our ArtNet universes 1-7 (receiving only)
3. Coordinate content schedule — when their projections are active vs. ours

---

## 6. Two-Side Synchronization

### How Port & Starboard Stay in Sync

Both sides are **inherently synchronized** because they receive data from the same source:

```
Control Computer (Chromatik)
    │
    │  ArtNet broadcast (UDP)
    │  Sends ALL universes simultaneously
    │
    ├──→ Port sealed box receives Universes 1 + 3
    │    (Port pars + Port LED strands)
    │
    └──→ Stbd sealed box receives Universes 2 + 4
         (Stbd pars + Stbd LED strands)
```

- **Zero drift:** Both sides process the same ArtNet frame at the same instant (network latency < 1ms on a local switch)
- **Mirror or independent:** Chromatik can send identical patterns to both sides (mirror mode) OR distinct content per side
- **Failover:** If one box loses network, the other side continues operating independently — the audience sees partial rather than total blackout

### Identical Hardware = Easy Spares
Port and starboard boxes are **identical builds.** If one fails, swap it with a spare or cannibalize the other side temporarily. All wiring is labeled and interchangeable.

---

## 7. Iceberg & Smokestack Systems

### Icebergs

Each of the 4 icebergs gets its own small sealed control box:

| Component | Hardware |
|-----------|----------|
| Sealed enclosure | Small IP65 box (Amazon) |
| Pixel controller | Chroma.tech Angio 8 (or smaller if <8 outputs needed) |
| PSU | Meanwell 5V 30A |
| Ethernet | Cat5 cable run back to main switch (or a local outdoor switch daisy-chain) |

The iceberg flood lights (rental light towers) are self-powered and can run standalone or accept DMX via a small ArtNet→DMX node.

### Smokestack Rings

Each ring gets a **dedicated Chroma.tech Angio 8 output** (or a shared controller if rings are co-located):

| Ring | LEDs | Controller | Notes |
|------|------|-----------|-------|
| Stack Top #1 (Port) | 60-120 | Angio 8 CH1 | Shared controller near stack base |
| Stack Top #2 (Stbd) | 60-120 | Angio 8 CH2 | Shared controller near stack base |
| Submerged Stack #1 | 60-120 | Angio 8 CH3 | Safety-critical visibility |
| Submerged Stack #2 | 60-120 | Angio 8 CH4 | Safety-critical visibility |

All receive ArtNet over the wired network — same as everything else.

---

## 8. Power Architecture

### Generator Requirements

| Load | Watts | Notes |
|------|-------|-------|
| Par lights (130 × 50W, ~50% avg) | 3,250W | Rarely at full white simultaneously |
| LED strands (both sides, all icebergs) | 800-1,200W | 5V PSU efficiency ~85% |
| Smokestack rings (4 × 22W) | ~90W | Negligible |
| Control equipment | 200W | Laptop, switches, Angio 8s |
| **Subtotal** | **~4,500-5,000W** | Excluding iceberg towers |
| Iceberg light towers (4×) | Self-powered | Each has its own diesel generator |

> [!IMPORTANT]
> **Minimum 6.5kW generator**, recommended **10kW** for headroom and growth.

### Power to Par Groups

```
Generator → Cam-Lock Distro Panel (200A)
                │
    ┌───────────┼────────────────────────────────┐
    │           │                                │
  20A×4       20A×4                            20A×2
  (Port pars) (Stbd pars)                     (LED PSUs + control)
    │           │                                │
    ▼           ▼                                ▼
  PowerCon   PowerCon                        AC outlets to
  trunks to  trunks to                       sealed boxes
  groups of 5 groups of 5                    (Meanwell PSUs inside)
```

### Power to Sealed Boxes
Each sealed box needs a **single AC power feed** (standard 120V/15A extension cord from distro panel). Inside the box, the Meanwell PSU converts to 5V for the Angio 8 and LED strips.

---

## 9. Complete Wiring Bill of Materials

### Network

| Item | Quantity | Notes |
|------|----------|-------|
| Managed/unmanaged Ethernet switch (8-16 port) | 1 | Main switch, playa tent |
| Small 5-port Ethernet switches | 2-4 | Inside sealed boxes |
| Cat5e outdoor-rated Ethernet cable | 200-300m | Runs to all boxes |
| RJ45 weatherproof connectors | 20+ | All outdoor cable ends |

### Par Lights (DMX Fixtures)

| Item | Quantity | Notes |
|------|----------|-------|
| IP65 LED Par RGBW (50-100W) | ~130 | Groups of 5 |
| PowerCon (old-style) jumpers, 1m | ~130 | Within-group daisy-chain |
| PowerCon trunk cables, 15-30m | 13-26 | Each group of 5 needs a trunk run |
| DMX 5-pin XLR cables, 1m | ~130 | Within-group daisy-chain |
| DMX 5-pin XLR trunk cables, 15-30m | 13-26 | From ArtNet→DMX node to first par |
| DMX terminators (120Ω) | 26 | One per group of 5 (end of chain) |
| ArtNet→DMX nodes | 2 | One per side (in sealed box) |

### LED Strip System

| Item | Quantity | Notes |
|------|----------|-------|
| **Chroma.tech Angio 8** | 4-6 | 2 main sides + icebergs + stacks |
| WS2812B 60LED/m IP65 (5m rolls) | 20-40 rolls | Hull strands + iceberg + rings |
| Meanwell LRS-350-5 (5V 60A PSU) | 4-8 | One per Angio 8 (or 2 for heavy loads) |
| 4-pin Phoenix screw terminals | Included w/ Angio 8 | Strip output connectors |
| 16-18 AWG power injection wire | 100-200m | 5V injection taps along strip runs |

### Sealed Enclosures

| Item | Quantity | Notes |
|------|----------|-------|
| IP65 NEMA enclosure (Amazon) | 4-6 | Port, Stbd, Icebergs, Stacks |
| IP68 cable glands (various sizes) | 50-80 | All cable entry points |
| DIN rail / mounting plate | 4-6 | Internal mounting |
| 120V outdoor extension cords (12AWG) | 4-6 | AC feed to each box |

---

## 10. Pre-Deployment Decisions

> [!WARNING]
> Lock these down **before** purchasing any hardware.

| # | Decision | Options | Impact |
|---|----------|---------|--------|
| 1 | **Par wattage** | 50W ✅ vs 100W | Groups of 5 power budget, circuit count |
| 2 | **Par fixture model** | Order 1 sample from eBay | Verify IP65, PowerCon, DMX modes |
| 3 | **LED strip voltage** | 5V (WS2812B) vs 12V (WS2815) | 12V = less injection, Angio 8 supports both |
| 4 | **Strand count & placement** | Finalize in simulation | Determines Angio 8 channel allocation |
| 5 | **Ethernet cable routing** | Trench vs surface runs | Bicycle/foot traffic hazard |
| 6 | **Iceberg network connection** | Direct Cat5 run vs local switch daisy-chain | Cable distance may require active switch |
| 7 | **Projection mapping universes** | Reserve 8-10 or more | Coordinate with projection team early |

---

## 11. Installation Sequence

| Phase | Task | Crew | Time |
|-------|------|------|------|
| 1 | Run generator + distro panel | 2 electricians | 4 hrs |
| 2 | Run Ethernet backbone (switch + trunk cables) | 1-2 techs | 2 hrs |
| 3 | Place + wire sealed control boxes (Port + Stbd) | 1 tech | 2 hrs |
| 4 | Run PowerCon trunks to par group locations | 2 people | 2 hrs |
| 5 | Mount par groups of 5 (Port side) | 2 people | 1 hr |
| 6 | Mount par groups of 5 (Stbd side) | 2 people | 1 hr |
| 7 | Connect DMX chains + verify ArtNet→DMX | 1 tech | 1 hr |
| 8 | Route + mount LED strands on hull | 4 people | 4-6 hrs |
| 9 | Place iceberg boxes, wire LED edge art | 2 people | 2 hrs/berg |
| 10 | Install smokestack ring LEDs | 2 people + VR | 2 hrs |
| 11 | Connect projection mapping port | 1 tech | 30 min |
| 12 | Full system test — all ArtNet universes | 1-2 techs | 2-3 hrs |
| 13 | Pattern programming + focus/aim | 1-2 designers | Ongoing |

**Total estimated lighting install:** ~24-32 crew-hours

---

## 12. Strike Plan

| System | Procedure | Time |
|--------|----------|------|
| Par groups | Unplug power + DMX, lift off hooks, pack in labeled bins | 1 hr/side |
| LED strands | Disconnect from Angio 8 outputs, pull off hull, coil | 2-3 hrs |
| Sealed boxes | Disconnect Ethernet + AC, remove from mounts, pack whole | 30 min |
| Smokestack rings | Unbolt brackets, lower rings, pack | 1 hr |
| Iceberg LED art | Detach strips, pack boxes | 30 min/berg |
| Network | Coil Ethernet cables, pack switch | 30 min |
| Power distro | Disconnect circuits, coil trunk cables | 1 hr |
| Generator | Return to rental | 30 min |

> [!IMPORTANT]
> **All electronics must be removed before burn.** LED strips, Angio 8s, PSUs, switches, cables — everything packs out.

---

## Appendix A: Key Parts & Costs

| Item | Source | Unit Cost | Qty |
|------|--------|-----------|-----|
| **Chroma.tech Angio 8** | chroma.tech | ~$200-300 | 4-6 |
| IP65 LED Par RGBW 50W | eBay (sample first) | $30-80 | 130+ |
| ArtNet→DMX node (2-universe) | DMXking eDMX2 PRO | $100-200 | 2 |
| Meanwell LRS-350-5 (5V 60A) | Amazon / Mouser | $25 | 4-8 |
| WS2812B 60LED/m IP65 (5m roll) | Amazon / BTF-Lighting | $15-25/roll | 20-40 |
| IP65 NEMA enclosure (medium) | Amazon | $40-80 | 4-6 |
| IP68 cable glands (assorted) | Amazon | $15/pack of 20 | 3-4 packs |
| 8-port outdoor Ethernet switch | Amazon / Ubiquiti | $30-100 | 1 |
| 5-port Ethernet switch (small) | Amazon | $15-25 | 2-4 |
| Cat5e outdoor cable (1000') | Amazon / Monoprice | $80/box | 1 |
| PowerCon jumpers 1m | Amazon / Sweetwater | $8-15 | 130+ |
| DMX 5-pin XLR 1m | Amazon / Monoprice | $5-10 | 130+ |
| DMX terminators (120Ω) | Amazon | $5 | 26 |
| 10kW Generator (rental) | Sunbelt / United Rentals | Rental | 1 |
| Mobile Light Tower (rental) | Sunbelt / United Rentals | Rental | 4 |
