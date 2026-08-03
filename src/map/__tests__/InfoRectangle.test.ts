import { describe, expect, it } from 'vitest';
import {
  getDefaultInfoRectanglePlacement,
  getInfoRectangle,
  getInfoRectanglePlacement,
  moveInfoRectangle,
  resizeInfoRectangle,
} from '@/map/InfoRectangle';

const bounds = { x: 20, y: 20, width: 960, height: 560 };

describe('information rectangle editing', () => {
  it('resolves the configurable default as a centered rectangle', () => {
    const placement = getDefaultInfoRectanglePlacement();
    expect(placement).toEqual({
      xRatio: 0.25,
      yRatio: 0.25,
      widthRatio: 0.5,
      heightRatio: 0.5,
    });
    expect(getInfoRectangle(1000, 600, placement)).toEqual({
      x: 250,
      y: 150,
      width: 500,
      height: 300,
    });
  });

  it('round-trips pixel geometry through normalized placement', () => {
    const rect = { x: 180, y: 90, width: 620, height: 360 };
    expect(getInfoRectangle(1000, 600, getInfoRectanglePlacement(rect, 1000, 600)))
      .toEqual(rect);
  });

  it('moves the rectangle without allowing it outside the canvas bounds', () => {
    const initial = { x: 250, y: 150, width: 500, height: 300 };
    expect(moveInfoRectangle(initial, 1000, -1000, bounds)).toEqual({
      x: 480,
      y: 20,
      width: 500,
      height: 300,
    });
  });

  it('resizes from sides and corners while enforcing minimum size and bounds', () => {
    const initial = { x: 250, y: 150, width: 500, height: 300 };
    expect(resizeInfoRectangle(initial, 'se', 500, 500, bounds, 120, 80)).toEqual({
      x: 250,
      y: 150,
      width: 730,
      height: 430,
    });
    expect(resizeInfoRectangle(initial, 'nw', 1000, 1000, bounds, 120, 80)).toEqual({
      x: 630,
      y: 370,
      width: 120,
      height: 80,
    });
    expect(resizeInfoRectangle(initial, 'w', -1000, 0, bounds, 120, 80)).toEqual({
      x: 20,
      y: 150,
      width: 730,
      height: 300,
    });
  });
});
