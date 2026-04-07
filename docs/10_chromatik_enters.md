# 🚀 Chromatik Enters the Stage (And Refuses to Leave)

## The Original Vision: A Bridge Too Far

In the innocent, dust-free early days of the BM26-Titanic project, our lighting architecture was firmly rooted in the web ecosystem. We had a beautiful Three.js simulation, a robust Node.js DMX Controller chucking raw Art-Net packets, and dreams of grandeur. Our procedural patterns were powered by the **MarsinEngine**—a blazing-fast WASM implementation of the PixelBlaze VM that let us run `.js` patterns identically in the browser and on physical hardware. We were smug. We were happy.

But as the scope of the Titanic grew, we realized a hard, brutal truth: while our engine was technically brilliant for generative code, we completely lacked a timeline-based, performance-ready UI. We needed a professional VJ interface to sequence, mix, and drop the bass on these patterns live on the playa, preferably while wearing goggles and a faux-fur coat.

Initially, we documented a plan (see `05_ndi_chromatik_pipeline.md`) to build an **NDI / WebSocket Bridge**. The idea was to keep our beloved simulation as the source of truth, beaming video frames over the network into **Chromatik** (LXStudio-TE) just for visualization and control. But let's be real: network bridges introduce latency, immense complexity, and exactly the kind of points of failure that wait to explode at 3 AM on a Wednesday in deep playa.

Why build a shaky, over-engineered bridge to a world-class lighting engine when we could just move into the engine itself and claim squatters' rights?

## The Pivot: Embracing LXStudio-TE

We decided to upgrade Chromatik from a "glorified visualizer" to the **Primary Brain** of the Titanic. Instead of passing pixels over NDI like peasants, we ported our intelligence directly into a custom fork: **LXStudio-TE**.

This required a profound architectural shift. We had to teach Chromatik how to speak to our exact physical rig, bypassing standard generic pixel protocols to handle complex multiparameter fixtures. It was like teaching a concert pianist how to play a kazoo—possible, but it took some patience.

### 1. Natively Modeling the Hardware (Or: Welcome to Java)
We abandoned the idea of Chromatik being "unaware" of the hardware. We recreated our exact fixture profiles right inside the Java source code, because nothing screams "art car" like compiling Java:
- `UkingParModel.java`: A native class handling the 10-channel RGBWAU + Strobe layout.
- `AdjStealthModel.java`: A native class handling its specific shutter/dimmer mechanics (because normal dimming is for cowards).
- A customized `.lxf` UI layer linking `dmx_universe` and `dmx_channel` offsets directly into the application GUI.

### 2. The Universal DMX Color Mapper
Chromatik is designed to output standard, polite RGB pixels. Our fixtures expected aggressive 10-channel DMX frames. Rather than forcing our VJs to write custom "DMX-aware" patterns and driving them to madness, we built the **DjLightsColorMapperEffect**.

This Java effect intercepts the global mixing bus, samples the generic colors produced by *any* Chromatik pattern (Solid, Noise, Sparks, etc.), and fundamentally translates them into specific DMX parameters (extracting White from RGB, splitting UV, and mapping the Dimmer). It allows VJs to mash buttons entirely agnostic of the horrific DMX hardware complexities beneath them.

### 3. Deep Universe Aggregation (Fixing UDP Anarchy)
We discovered a severe architectural quirk during the integration: Chromatik was eagerly transmitting a separate 512-byte UDP packet *for every single fixture*. When dealing with multiple lights on the same universe, the packets collided violently in mid-air, indiscriminately overwriting each other with zeros like a chaotic UDP demolition derby.

We completely rewrote the internal `DmxEngine` to mirror the topology we had perfected in our old Node.js core: **Universe Aggregation**. The system now mathematically hashes all geometric models into a unified 512-channel persistent buffer in memory, transmitting exactly one polite E1.31 sACN payload per frame. Order was restored.

## The Safety Net: The sACN Smart Priority Router

By shifting to Chromatik, we gained immense VJ power, but we didn't want to throw away our rock-solid Node.js/WASM ecosystem. After all, what if a heavy Java shader crashes Chromatik mid-burn, leaving the Titanic completely dark and highly un-majestic?

To achieve ultimate peace of mind (and prevent panic attacks), we implemented the **sACN Smart Priority Router** (`sacn_smart_router.js`).

Our network now operates on a tiered hierarchy utilizing native sACN (E1.31) priority semantics, because hardware merging is a myth and a lie:
* **Priority 100 (The Backup):** The headless Node.js BM26 engine runs endlessly in the background, rendering safe, generative WASM patterns to `127.0.0.1`. It is the loyal golden retriever of lighting engines.
* **Priority 200 (The Show):** Chromatik broadcasts the live VJ performance. It is the undeniable rockstar.

The lightweight Smart Router sits between the software and the physical lights as the ultimate bouncer. The instant Chromatik boots up and broadcasts Priority 200, the router seamlessly locks on, instantly shoving the background Node process aside. If Chromatik crashes, is paused, or is closed so the VJ can check Facebook, the router detects the packet drop, waits a polite 10 seconds, and seamlessly falls back to the Node.js autonomous engine. The music never stops.

## Conclusion

Chromatik didn't just enter the project as a shiny UI—it forced a chaotic but necessary maturation of our entire data pipeline. We achieved a professional-grade VJ interface deeply coupled to our bespoke hardware, underpinned by a seamless, autonomous fallback engine that ensures the Titanic never, ever goes dark.
