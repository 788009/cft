import { describe, expect, it } from 'vitest';
import { calculateArrows, getRayIntersection } from '../arrow';

const rect = { x: 25, y: 25, width: 50, height: 50 };
const center = { x: 50, y: 50 };

describe('Search arrow logic', () => {
  it('finds ray intersections and ignores targets inside the rectangle', () => {
    expect(getRayIntersection(center, { x: 100, y: 50 }, rect)).toEqual({ x: 75, y: 50 });
    expect(getRayIntersection(center, { x: 50, y: 0 }, rect)).toEqual({ x: 50, y: 25 });
    expect(getRayIntersection(center, { x: 60, y: 60 }, rect)).toBeNull();
  });

  it('merges nearby arrows only when they are on the same edge', () => {
    const groups = calculateArrows(center, rect, [
      { id: 'right-a', target: { x: 100, y: 49 } },
      { id: 'right-b', target: { x: 100, y: 55 } },
      { id: 'top', target: { x: 74, y: 0 } },
    ], 10);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.edge === 'right')?.ids).toEqual(['right-a', 'right-b']);
    expect(groups.find((group) => group.edge === 'top')?.ids).toEqual(['top']);
  });

  it('splits same-edge arrows after their distance exceeds the threshold', () => {
    const targets = [
      { id: 'a', target: { x: 100, y: 35 } },
      { id: 'b', target: { x: 100, y: 65 } },
    ];
    expect(calculateArrows(center, rect, targets, 20)).toHaveLength(1);
    expect(calculateArrows(center, rect, targets, 10)).toHaveLength(2);
  });

  it('does not merge a chain wider than the configured distance', () => {
    const groups = calculateArrows(center, rect, [
      { id: 'a', target: { x: 100, y: 10 } },
      { id: 'b', target: { x: 100, y: 50 } },
      { id: 'c', target: { x: 100, y: 90 } },
    ], 25);
    expect(groups.map((group) => group.ids)).toEqual([['a', 'b'], ['c']]);
  });

  it('uses the circular average for a merged arrow direction', () => {
    const [group] = calculateArrows(center, rect, [
      { id: 'a', target: { x: 100, y: 45 } },
      { id: 'b', target: { x: 100, y: 55 } },
    ], 10);
    expect(group.angle).toBeCloseTo(0, 10);
    expect(group.count).toBe(2);
  });
});
