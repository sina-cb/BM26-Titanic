import fs from 'fs';
import yaml from 'js-yaml';

const model = {
  id: "vintage_led_33",
  name: "Vintage LED Stage Light (33ch)",
  fixture_type: "VintageLed",
  channel_mode: 33,
  dimensions: { width: 80, height: 430, depth: 60 },
  shell: {
    type: "box",
    dimensions: [90, 460, 60],
    color: "#111111",
    offset: [0, 187.5, -40] // Centered behind the 6 heads (0 to 375) and pushed back
  },
  pixels: [],
  controls: [
    { channel: 1,  function: "Total Dimming", range: "0=dark, 255=max" },
    { channel: 2,  function: "Total Strobe", range: "0=off, 255=fast" },
    { channel: 9,  function: "Aux Red (global)", range: "0-255" },
    { channel: 10, function: "Aux Green (global)", range: "0-255" },
    { channel: 11, function: "Aux Blue (global)", range: "0-255" },
    { channel: 12, function: "Main Light Effect", range: "0-255, see Appendix 1" },
    { channel: 13, function: "Main Effect Speed", range: "0-127=fwd, 128-255=rev" },
    { channel: 14, function: "Aux Light Effect", range: "0-255, see Appendix 1" },
    { channel: 15, function: "Aux Effect Speed", range: "0-127=fwd, 128-255=rev" }
  ]
};

const NUM_HEADS = 6;
const DOTS_PER_RING = 24;
const RING_RADIUS = 36; // 7.2cm diameter circle

// Run with `node gen_vintage.js --detailed` to generate the complex physical layout
const useDetailedMode = process.argv.includes('--detailed');

for (let i = 0; i < NUM_HEADS; i++) {
  const headNum = i + 1;
  const yOffset = i * 75; // 75mm spacing to fit the 72mm rings

  if (useDetailedMode) {
    // The center "amber" (warm) light - tall rectangle
    model.pixels.push({
      id: `head_${headNum}_warm`,
      type: "warm",
      size: [15, 60, 10], // Very tall bright light in center
      channels: { value: 2 + headNum }, // CH3 to CH8
      dots: [[0, yOffset, 0]]
    });

    // The RGB ring
    const rgbDots = [];
    for (let d = 0; d < DOTS_PER_RING; d++) {
      const angle = (d / DOTS_PER_RING) * Math.PI * 2;
      rgbDots.push([
        Number((Math.cos(angle) * RING_RADIUS).toFixed(2)),
        Number((yOffset + Math.sin(angle) * RING_RADIUS).toFixed(2)),
        -5
      ]);
    }

    model.pixels.push({
      id: `head_${headNum}_aux`,
      type: "rgb",
      size: 4, // 4mm radius for each little RGB dot making the circle
      channels: {
        red: 16 + i*3,
        green: 17 + i*3,
        blue: 18 + i*3
      },
      dots: rgbDots
    });
  } else {
    // Combined warm + RGB aux pixel (simplified)
    model.pixels.push({
      id: `head_${headNum}`,
      type: "rgbw",
      size: 18,
      channels: {
        value: 2 + headNum, // CH3 to CH8 (warm)
        red: 16 + i*3,      // RGB aux
        green: 17 + i*3,
        blue: 18 + i*3
      },
      dots: [[0, yOffset, -5]]
    });
  }
}

const yamlStr = yaml.dump({ model }, { condenseFlow: true });
fs.writeFileSync('./model_33.yaml', 
  "# Vintage LED Stage Light — Pixel Model (33ch mode)\n" +
  "# 6 retro Edison bulb heads arranged vertically.\n" + yamlStr);
