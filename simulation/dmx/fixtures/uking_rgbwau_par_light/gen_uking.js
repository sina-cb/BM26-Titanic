import fs from 'fs';
import yaml from 'js-yaml';

// Run with `node gen_uking.js --detailed` to generate the 18-dot model
const useDetailedMode = process.argv.includes('--detailed');

const model = {
  id: "uking_par_10",
  name: "UKing RGBWAU PAR (10ch)",
  fixture_type: "UkingPar",
  channel_mode: 10,
  dimensions: { width: 150, height: 150, depth: 120 },
  shell: {
    type: "cylinder",
    dimensions: [150, 150, 120],
    color: "#111111",
    offset: [0, 0, -60]
  },
  pixels: [
    {
      id: "rgbwau_1",
      type: "rgbwau",
      size: useDetailedMode ? 10 : 39, // 39mm central dot for simplified
      channels: {
        dimmer: 1, red: 2, green: 3, blue: 4, white: 5, amber: 6, purple: 7, strobe: 8, function: 9, function_speed: 10
      },
      dots: []
    }
  ],
  controls: [
    { channel: 1, function: "Total Dimmer", range: "0=dark, 255=max" },
    { channel: 8, function: "Total Strobe", range: "0=off, 1-255=slow→fast" },
    {
      channel: 9,
      function: "Function Select",
      range: "0-50=manual, 51-100=color, 101-150=jump, 151-200=fade, 201-250=pulse, 251-255=sound",
    },
    { channel: 10, function: "Function Speed", range: "0=slow, 255=fast" }
  ]
};

if (useDetailedMode) {
  model.pixels[0].dots = [
    // Inner ring (r=22mm, 6 LEDs at 60° intervals)
    [22, 0, 0], [11, 19.05, 0], [-11, 19.05, 0], [-22, 0, 0], [-11, -19.05, 0], [11, -19.05, 0],
    // Middle ring (r=44mm, 6 LEDs at 60° intervals, 30° offset)
    [38.1, 22, 0], [0, 44, 0], [-38.1, 22, 0], [-38.1, -22, 0], [0, -44, 0], [38.1, -22, 0],
    // Outer ring (r=66mm, 6 LEDs at 60° intervals)
    [66, 0, 0], [33, 57.16, 0], [-33, 57.16, 0], [-66, 0, 0], [-33, -57.16, 0], [33, -57.16, 0]
  ];
} else {
  // Simplified mode - 1 big central dot
  model.pixels[0].dots = [[0, 0, 0]];
}

const yamlStr = yaml.dump({ model }, { condenseFlow: true });
fs.writeFileSync('./model_10.yaml', 
  "# UKing RGBWAU PAR Light — Pixel Model (10ch mode)\n" +
  "# Single DMX pixel with 1 big dot (simplified) or 18 visual dots (detailed).\n" + yamlStr);
