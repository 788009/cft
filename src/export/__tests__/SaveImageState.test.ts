import { describe, expect, it } from 'vitest';
import { SaveImageState } from '../SaveImageState';

describe('save image state', () => {
  it('starts with the configured 1.6 default dimensions', () => {
    expect(new SaveImageState().getSnapshot()).toEqual({
      width: 2880,
      height: 1800,
      aspectRatio: 1.6,
      fontScaleMultiplier: 1,
      fontScale: 1,
    });
  });

  it('links width and height using the current ratio', () => {
    const state = new SaveImageState();
    expect(state.setWidth(3200)).toMatchObject({ width: 3200, height: 2000 });
    expect(state.setHeight(1600)).toMatchObject({ width: 2560, height: 1600 });
  });

  it('updates output dimensions independently after a map region drag', () => {
    const state = new SaveImageState();
    expect(state.applyMapResize(
      { x: 0, y: 0, width: 960, height: 600 },
      { x: 0, y: 0, width: 800, height: 480 },
    )).toMatchObject({
      width: 2400,
      height: 1440,
      aspectRatio: 5 / 3,
    });
  });

  it('combines area-derived font scaling with a temporary multiplier', () => {
    const state = new SaveImageState({ width: 1440, height: 900 });
    expect(state.getSnapshot().fontScale).toBe(0.5);
    expect(state.setFontScaleMultiplier(1.4).fontScale).toBeCloseTo(0.7);
  });

  it('constrains linked dimensions to the configured pixel limit', () => {
    const state = new SaveImageState();
    const snapshot = state.setWidth(8192);
    expect(snapshot.width * snapshot.height).toBeLessThanOrEqual(32_000_000);
    expect(snapshot.aspectRatio).toBeCloseTo(1.6, 3);
  });
});
