export interface SharedPixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SharedPixelPanel {
  weight: number;
  bounds: SharedPixelBounds;
}

export interface SharedFlatPixelView {
  panels: SharedPixelPanel[];
  bounds: SharedPixelBounds;
}

export interface SharedPixelDesign {
  panelGap: number;
}

export interface SharedViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const FIT_FILL: number;
export function arrangePanels(
  flat: SharedFlatPixelView,
  design: SharedPixelDesign,
  viewportW: number,
  viewportH: number,
  axis: 'columns' | 'rows',
): { transforms: SharedViewTransform[]; glyphScale: number };
export function layoutView(
  flat: SharedFlatPixelView,
  design: SharedPixelDesign,
  viewportW: number,
  viewportH: number,
): SharedViewTransform[];
