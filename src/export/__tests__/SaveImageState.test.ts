import { describe, expect, it } from 'vitest';
import { SaveImageState } from '../SaveImageState';

describe('save image state', () => {
  it('starts with the configured 1.6 default dimensions', () => {
    expect(new SaveImageState().getSnapshot()).toEqual({
      addedImages: [],
      width: 2880,
      height: 1800,
      aspectRatio: 1.6,
      fontScaleMultiplier: 1,
      fontScale: 1.9460170216420796,
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

  it('derives live drag dimensions from the drag-start snapshot', () => {
    const state = new SaveImageState();
    const initialDimensions = state.getSnapshot();
    const initialMapRect = { x: 0, y: 0, width: 960, height: 600 };
    state.applyMapResize(
      initialMapRect,
      { x: 0, y: 0, width: 800, height: 500 },
      initialDimensions,
    );
    expect(state.applyMapResize(
      initialMapRect,
      { x: 0, y: 0, width: 700, height: 400 },
      initialDimensions,
    )).toMatchObject({ width: 2100, height: 1200 });
  });

  it('preserves linked dimensions beyond the configured warning thresholds', () => {
    const state = new SaveImageState();
    const snapshot = state.setWidth(8192);
    expect(snapshot).toMatchObject({ width: 8192, height: 5120 });
  });
});
