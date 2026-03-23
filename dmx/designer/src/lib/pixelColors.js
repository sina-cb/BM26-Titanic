/**
 * Helper to compute dot colors based on pixel type and test pattern.
 */

const IDLE_COLORS = {
  rgb: '#333333',
  rgbw: '#333333',
  rgbwau: '#333333',
  single: '#444444', 
  warm: '#4a3b10'
};

export function getDotColor(pixel, testPattern) {
  if (!testPattern) {
    if (pixel.type === 'single' && pixel.color_hint) {
      // Dim version of the hint color
      return blendColors(pixel.color_hint, '#000000', 0.8);
    }
    return IDLE_COLORS[pixel.type] || IDLE_COLORS.rgb;
  }

  // Visual stub for DMX test patterns
  switch (testPattern) {
    case 'red':
      if (['rgb', 'rgbw', 'rgbwau'].includes(pixel.type)) return '#ff0000';
      break;
    case 'green':
      if (['rgb', 'rgbw', 'rgbwau'].includes(pixel.type)) return '#00ff00';
      break;
    case 'blue':
      if (['rgb', 'rgbw', 'rgbwau'].includes(pixel.type)) return '#0000ff';
      break;
    case 'white':
      if (pixel.type === 'warm') return '#ffd700'; // Warm white
      if (pixel.color_hint === '#FFFFFF') return '#ffffff';
      if (['rgbw', 'rgbwau'].includes(pixel.type)) return '#ffffff';
      break;
    case 'amber':
      if (pixel.type === 'warm') return '#ffbf00';
      if (pixel.color_hint === '#FFBF00') return '#ffbf00';
      if (pixel.type === 'rgbwau') return '#ffbf00';
      break;
    case 'purple':
      if (pixel.type === 'rgbwau') return '#800080';
      if (pixel.type === 'rgb') return '#800080'; // approximation
      break;
    case 'all_on':
      if (pixel.type === 'warm') return '#ffd700';
      if (pixel.type === 'single') return pixel.color_hint || '#ffffff';
      if (pixel.type === 'rgbwau') return '#fff8f0'; // mixed slightly warm
      return '#ffffff';
    case 'blackout':
      return '#000000';
  }

  return IDLE_COLORS[pixel.type] || IDLE_COLORS.rgb;
}

function blendColors(c1, c2, r) {
  // Very rough hex blend just for the UI idle state
  return c1; // Implement proper blend if needed, for now just returning c1 or leaving it
}
