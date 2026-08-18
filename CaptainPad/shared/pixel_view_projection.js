/*
 * One projection authority for Deck and Live Touch pixel maps.
 *
 * Geometry and pixel identity come from the generated simulation artifact.
 * This module owns only the final, aspect-preserving panel arrangement inside
 * a viewport. It is deliberately dependency-free so Metro, Node, and the
 * offline Live Touch page execute the same function object and arithmetic.
 */
(function installPixelViewProjection(root) {
  'use strict';

  var FIT_FILL = 0.92;

  function fail(message) {
    throw new Error('[PixelProjection] ' + message);
  }

  function arrangePanels(flat, design, viewportW, viewportH, axis) {
    if (!flat || !Array.isArray(flat.panels) || !flat.panels.length) {
      fail('a non-empty flattened view is required');
    }
    if (!(viewportW > 0) || !(viewportH > 0)) {
      fail('viewport must be positive, got ' + viewportW + 'x' + viewportH);
    }
    if (axis !== 'columns' && axis !== 'rows') fail("axis must be 'columns' or 'rows'");

    var count = flat.panels.length;
    var gap = count > 1 ? design.panelGap : 0;
    var along = axis === 'columns' ? viewportW : viewportH;
    var totalWeight = flat.panels.reduce(function (sum, panel) { return sum + panel.weight; }, 0);
    var inner = Math.max(1e-6, along - gap * (count - 1));
    var boxW = Math.max(1e-6, flat.bounds.maxX - flat.bounds.minX);
    var boxH = Math.max(1e-6, flat.bounds.maxY - flat.bounds.minY);
    var base = [];
    var cursor = 0;

    flat.panels.forEach(function (panel) {
      var share = inner * (panel.weight / totalWeight);
      var stripW = axis === 'columns' ? share : viewportW;
      var stripH = axis === 'columns' ? viewportH : share;
      var scale = Math.max(0, Math.min(stripW / boxW, stripH / boxH));
      var padX = (stripW - boxW * scale) / 2 - flat.bounds.minX * scale;
      var padY = (stripH - boxH * scale) / 2 - flat.bounds.minY * scale;
      base.push({
        scale: scale,
        offsetX: (axis === 'columns' ? cursor : 0) + padX,
        offsetY: (axis === 'columns' ? 0 : cursor) + padY,
      });
      cursor += share + gap;
    });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    flat.panels.forEach(function (panel, index) {
      var transform = base[index];
      var x0 = panel.bounds.minX * transform.scale + transform.offsetX;
      var x1 = panel.bounds.maxX * transform.scale + transform.offsetX;
      var y0 = panel.bounds.minY * transform.scale + transform.offsetY;
      var y1 = panel.bounds.maxY * transform.scale + transform.offsetY;
      if (x0 < minX) minX = x0;
      if (x1 > maxX) maxX = x1;
      if (y0 < minY) minY = y0;
      if (y1 > maxY) maxY = y1;
    });
    var fit = Math.min(
      viewportW * FIT_FILL / Math.max(1e-6, maxX - minX),
      viewportH * FIT_FILL / Math.max(1e-6, maxY - minY)
    );
    var centerX = (minX + maxX) / 2;
    var centerY = (minY + maxY) / 2;
    return {
      glyphScale: base[0].scale * fit,
      transforms: base.map(function (transform) {
        return {
          scale: transform.scale * fit,
          offsetX: (transform.offsetX - centerX) * fit + viewportW / 2,
          offsetY: (transform.offsetY - centerY) * fit + viewportH / 2,
        };
      }),
    };
  }

  function layoutView(flat, design, viewportW, viewportH) {
    var columns = arrangePanels(flat, design, viewportW, viewportH, 'columns');
    if (flat.panels.length < 2) return columns.transforms;
    var rows = arrangePanels(flat, design, viewportW, viewportH, 'rows');
    return rows.glyphScale > columns.glyphScale ? rows.transforms : columns.transforms;
  }

  var api = Object.freeze({ FIT_FILL: FIT_FILL, arrangePanels: arrangePanels, layoutView: layoutView });
  root.DeckPixelProjection = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
