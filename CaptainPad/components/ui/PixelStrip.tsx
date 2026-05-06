import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

/**
 * PixelStrip — Renders a horizontal strip of MarsinPixel RGBWAU data.
 * Each pixel is 6 bytes (R, G, B, W, A, U). Renders as a colored bar.
 * 
 * Color mapping for display:
 *   W (White)  → Cool white  (200, 220, 255)
 *   A (Amber)  → Yellow-white (255, 200, 50)
 *   U (UV)     → Dark purple  (75, 0, 130)
 */
const BYTES_PER_PIXEL = 6;

// WAU display contribution per unit (0-1)
const W_R = 200/255, W_G = 220/255, W_B = 255/255; // cool white
const A_R = 255/255, A_G = 200/255, A_B =  50/255;  // yellow amber
const U_R =  75/255, U_G =   0/255, U_B = 130/255;  // dark purple

export const PixelStrip = ({ 
  base64Data, 
  pixelCount = 64,
  height = 12,
  style,
}: {
  base64Data: string | null;
  pixelCount?: number;
  height?: number;
  style?: any;
}) => {
  const pixels = useMemo(() => {
    if (!base64Data) return null;
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const count = Math.min(pixelCount, Math.floor(bytes.length / BYTES_PER_PIXEL));
      const colors: string[] = [];
      for (let i = 0; i < count; i++) {
        const off = i * BYTES_PER_PIXEL;
        const r = bytes[off];
        const g = bytes[off + 1];
        const b = bytes[off + 2];
        const w = bytes[off + 3];
        const a = bytes[off + 4];
        const u = bytes[off + 5];

        // Combine RGBWAU into display RGB
        const dr = Math.min(255, Math.round(r + w * W_R + a * A_R + u * U_R));
        const dg = Math.min(255, Math.round(g + w * W_G + a * A_G + u * U_G));
        const db = Math.min(255, Math.round(b + w * W_B + a * A_B + u * U_B));

        colors.push(`rgb(${dr},${dg},${db})`);
      }
      return colors;
    } catch {
      return null;
    }
  }, [base64Data, pixelCount]);

  if (!pixels || pixels.length === 0) {
    return (
      <View style={[styles.strip, styles.emptyStrip, { height }, style]} />
    );
  }

  return (
    <View style={[styles.strip, { height }, style]}>
      {pixels.map((color, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  emptyStrip: {
    backgroundColor: '#0a0a0a',
    borderColor: 'rgba(255,255,255,0.04)',
  },
});
