import { describe, expect, it } from 'vitest';
import { getSearchControlPlacement } from '../placement';

describe('Search control placement', () => {
  it('places a top-left search control inside the viewport margin', () => {
    expect(getSearchControlPlacement({
      viewportWidth: 1200,
      viewportHeight: 800,
      width: 448,
      height: 44,
      corner: 'top-left',
      margin: 12,
      gap: 8,
      occupiedRects: [],
    })).toEqual({ x: 12, y: 12, width: 448, height: 44 });
  });

  it('moves left-corner controls inward after an occupied sibling', () => {
    expect(getSearchControlPlacement({
      viewportWidth: 1200,
      viewportHeight: 800,
      width: 448,
      height: 44,
      corner: 'top-left',
      margin: 12,
      gap: 8,
      occupiedRects: [{ x: 12, y: 12, width: 44, height: 44 }],
    }).x).toBe(64);
  });

  it('moves right-corner controls left while preserving bottom alignment', () => {
    expect(getSearchControlPlacement({
      viewportWidth: 1200,
      viewportHeight: 800,
      width: 320,
      height: 44,
      corner: 'bottom-right',
      margin: 12,
      gap: 8,
      occupiedRects: [{ x: 1144, y: 744, width: 44, height: 44 }],
    })).toEqual({ x: 816, y: 744, width: 320, height: 44 });
  });
});
