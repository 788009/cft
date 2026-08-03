import { describe, expect, it } from 'vitest';
import { calculateInitialMapTransform } from '@/map/InitialView';

describe('initial map view', () => {
  it('centers the school bounds and fits the dominant horizontal axis to the target ratio', () => {
    const transform = calculateInitialMapTransform(
      [{ x: 100, y: 100 }, { x: 500, y: 300 }],
      { width: 1000, height: 600 },
      { x: 250, y: 150, width: 500, height: 300 },
      0.8,
    );

    expect(transform).toEqual({ x: 200, y: 100, k: 1 });
    expect(transform.x + ((100 + 500) / 2) * transform.k).toBe(500);
    expect((500 - 100) * transform.k / 500).toBe(0.8);
    expect((300 - 100) * transform.k / 300).toBeLessThan(0.8);
  });

  it('fits the dominant vertical axis and supports a single school point', () => {
    const vertical = calculateInitialMapTransform(
      [{ x: 300, y: 100 }, { x: 400, y: 500 }],
      { width: 1000, height: 600 },
      { x: 250, y: 150, width: 500, height: 300 },
      0.8,
    );
    expect(vertical.k).toBe(0.6);
    expect(vertical.x + 350 * vertical.k).toBe(500);
    expect(vertical.y + 300 * vertical.k).toBe(300);
    expect(400 * vertical.k / 300).toBe(0.8);

    expect(calculateInitialMapTransform(
      [{ x: 120, y: 80 }],
      { width: 1000, height: 600 },
      { x: 250, y: 150, width: 500, height: 300 },
      0.8,
    )).toEqual({ x: 380, y: 220, k: 1 });
  });

  it('keeps the identity transform when there are no domestic points', () => {
    expect(calculateInitialMapTransform(
      [],
      { width: 1000, height: 600 },
      { x: 250, y: 150, width: 500, height: 300 },
      0.8,
    )).toEqual({ x: 0, y: 0, k: 1 });
  });
});
