import { describe, it, expect } from 'vitest';
import { calculateLayout, getConnectionPoint, isOverlap, isInside } from '../layout';
import type { LayoutInput, LayoutConfig, Rect } from '../layout';

describe('Layout Logic', () => {
  const config: LayoutConfig = {
    canvasRect: { x: 0, y: 0, width: 1000, height: 1000 },
    infoRect: { x: 250, y: 250, width: 500, height: 500 },
    obstacles: [],
    spacing: 10,
    weights: {
      overlap: 10000,
      outOfBounds: 5000,
      anchorOcclusion: 2000,
      lineIntersection: 1000,
      distance: 1,
      stability: 50,
    },
  };

  it('should correctly detect overlaps and containment', () => {
    const r1: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const r2: Rect = { x: 90, y: 90, width: 100, height: 100 };
    const r3: Rect = { x: 120, y: 120, width: 100, height: 100 };

    expect(isOverlap(r1, r2, 0)).toBe(true);
    expect(isOverlap(r1, r3, 0)).toBe(false);
    
    // Spacing check
    expect(isOverlap(r1, r3, 30)).toBe(true);

    expect(isInside(r1, { x: 0, y: 0, width: 200, height: 200 })).toBe(true);
    expect(isInside(r1, { x: 10, y: 10, width: 200, height: 200 })).toBe(false);
  });

  it('should place new items without overlapping and outside infoRect', () => {
    const items: LayoutInput[] = [
      { id: 'school1', anchor: { x: 500, y: 500 }, width: 100, height: 50 },
      { id: 'school2', anchor: { x: 500, y: 500 }, width: 100, height: 50 },
    ];
    
    const previousLayout = new Map<string, Rect>();
    
    const result = calculateLayout(items, previousLayout, config);
    
    expect(result.size).toBe(2);
    const rect1 = result.get('school1')!;
    const rect2 = result.get('school2')!;
    
    // 不重叠
    expect(isOverlap(rect1, rect2, config.spacing)).toBe(false);
    
    // 不在 infoRect 内
    expect(isOverlap(rect1, config.infoRect, 0)).toBe(false);
    expect(isOverlap(rect2, config.infoRect, 0)).toBe(false);
    
    // 在 Canvas 内
    expect(isInside(rect1, config.canvasRect)).toBe(true);
    expect(isInside(rect2, config.canvasRect)).toBe(true);
  });

  it('should keep existing items stable and not push them', () => {
    const items: LayoutInput[] = [
      { id: 'old_school', anchor: { x: 100, y: 100 }, width: 100, height: 50 },
      { id: 'new_school', anchor: { x: 150, y: 150 }, width: 100, height: 50 },
    ];

    // 旧学校已经位于 (0, 0)
    const previousLayout = new Map<string, Rect>([
      ['old_school', { x: 0, y: 0, width: 100, height: 50 }]
    ]);

    const result = calculateLayout(items, previousLayout, config);
    
    const oldRect = result.get('old_school')!;
    const newRect = result.get('new_school')!;

    // 稳定保持位置
    expect(oldRect.x).toBe(0);
    expect(oldRect.y).toBe(0);

    // 新学校应当放置在不重叠的其他地方
    expect(isOverlap(oldRect, newRect, config.spacing)).toBe(false);
  });

  it('should reserve obstacle rectangles without moving valid existing labels', () => {
    const obstacle = { x: 800, y: 0, width: 200, height: 200 };
    const items: LayoutInput[] = [
      { id: 'stable', anchor: { x: 500, y: 500 }, width: 100, height: 50 },
      { id: 'new', anchor: { x: 900, y: 100 }, width: 100, height: 50 },
    ];
    const previous = new Map<string, Rect>([
      ['stable', { x: 0, y: 0, width: 100, height: 50 }],
    ]);

    const result = calculateLayout(items, previous, { ...config, obstacles: [obstacle] });
    expect(result.get('stable')).toEqual(previous.get('stable'));
    expect(isOverlap(result.get('new')!, obstacle, config.spacing)).toBe(false);
  });

  it('should restore a re-entering item from layout history', () => {
    const previous = new Map<string, Rect>([
      ['returning', { x: 40, y: 80, width: 100, height: 50 }],
    ]);
    const result = calculateLayout([
      { id: 'returning', anchor: { x: 600, y: 500 }, width: 100, height: 50 },
    ], previous, config);

    expect(result.get('returning')).toEqual(previous.get('returning'));
  });

  it('should connect a line to the nearest label edge', () => {
    expect(getConnectionPoint({ x: 50, y: 150 }, { x: 100, y: 100, width: 100, height: 100 }))
      .toEqual({ x: 100, y: 150 });
  });
});
