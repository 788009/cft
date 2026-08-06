import { describe, expect, it } from 'vitest';
import {
  calculateAreaFontScale,
  calculateInitialSaveImageLayout,
  createSaveImageModeLayout,
  linkImageDimensions,
  resizeSaveImageMapRect,
  scaleImageDimensionsForMapResize,
} from '../geometry';

describe('save image geometry', () => {
  it('uses a right menu for an equal-area landscape tie', () => {
    const layout = calculateInitialSaveImageLayout({
      viewportWidth: 1440,
      viewportHeight: 900,
      mapAspectRatio: 1.6,
      menuReservedRatio: 1 / 3,
    });

    expect(layout).toEqual({
      mapRect: { x: 0, y: 0, width: 960, height: 600 },
      menuRect: { x: 960, y: 0, width: 480, height: 600 },
      blankRects: [{ x: 0, y: 600, width: 1440, height: 300 }],
      menuPlacement: 'right',
    });
  });

  it('maximizes the map with a bottom menu in a portrait viewport', () => {
    const layout = calculateInitialSaveImageLayout({
      viewportWidth: 600,
      viewportHeight: 900,
      mapAspectRatio: 1.6,
      menuReservedRatio: 1 / 3,
    });

    expect(layout.mapRect).toEqual({ x: 0, y: 0, width: 600, height: 375 });
    expect(layout.menuRect).toEqual({ x: 0, y: 375, width: 600, height: 525 });
    expect(layout.blankRects).toEqual([]);
    expect(layout.menuPlacement).toBe('bottom');
  });

  it('partitions resized map, menu and blank regions without overlap', () => {
    expect(createSaveImageModeLayout(
      1200,
      800,
      { x: 20, y: 30, width: 700, height: 500 },
      'bottom',
    )).toEqual({
      mapRect: { x: 0, y: 0, width: 700, height: 500 },
      menuRect: { x: 0, y: 500, width: 700, height: 300 },
      blankRects: [{ x: 700, y: 0, width: 500, height: 800 }],
      menuPlacement: 'bottom',
    });
  });

  it('resizes from the enabled save image handles and clamps to the viewport', () => {
    const initialMapRect = { x: 0, y: 0, width: 600, height: 400 };
    expect(resizeSaveImageMapRect({
      initialMapRect,
      handle: 'east',
      deltaX: 500,
      deltaY: 100,
      viewportWidth: 1000,
      viewportHeight: 800,
      minWidth: 120,
      minHeight: 80,
    })).toEqual({ x: 0, y: 0, width: 1000, height: 400 });
    expect(resizeSaveImageMapRect({
      initialMapRect,
      handle: 'south-east',
      deltaX: -1000,
      deltaY: -1000,
      viewportWidth: 1000,
      viewportHeight: 800,
      minWidth: 120,
      minHeight: 80,
    })).toEqual({ x: 0, y: 0, width: 120, height: 80 });
  });

  it('links dimensions and scales both axes from a dragged map rectangle', () => {
    expect(linkImageDimensions('width', 3200, 1.6)).toEqual({ width: 3200, height: 2000 });
    expect(linkImageDimensions('height', 1600, 1.6)).toEqual({ width: 2560, height: 1600 });
    expect(scaleImageDimensionsForMapResize(
      { width: 2880, height: 1800 },
      { x: 0, y: 0, width: 960, height: 600 },
      { x: 0, y: 0, width: 800, height: 500 },
    )).toEqual({ width: 2400, height: 1500 });
  });

  it('scales default font size with the square root of map area', () => {
    expect(calculateAreaFontScale(
      { width: 1440, height: 900 },
      { width: 2880, height: 1800 },
    )).toBe(0.5);
    expect(calculateAreaFontScale(
      { width: 5760, height: 3600 },
      { width: 2880, height: 1800 },
      1.25,
    )).toBe(2.5);
  });
});
