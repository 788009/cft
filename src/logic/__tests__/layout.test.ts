import { describe, it, expect } from 'vitest';
import {
  calculateFittingLayout,
  calculateLayout,
  createScaleCandidates,
  getConnectionPoint,
  getBestConnectionPoint,
  getConnectionPointCandidates,
  getDistanceCost,
  doesSegmentIntersectRectInterior,
  getDistanceToRectBoundary,
  isOverlap,
  isInside,
  layoutSatisfiesHardConstraints,
} from '../layout';
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
      lineOcclusion: 4000,
      infoEdgeDistance: 20,
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

  it('uses a quadratic distance penalty', () => {
    expect(getDistanceCost({ x: 0, y: 0 }, { x: 3, y: 4 }, 2)).toBe(50);
  });

  it('measures a connection point distance to the information rectangle boundary', () => {
    const rect = { x: 100, y: 100, width: 100, height: 100 };
    expect(getDistanceToRectBoundary({ x: 150, y: 80 }, rect)).toBe(20);
    expect(getDistanceToRectBoundary({ x: 80, y: 80 }, rect)).toBeCloseTo(Math.hypot(20, 20));
    expect(getDistanceToRectBoundary({ x: 150, y: 150 }, rect)).toBe(50);
  });

  it('places a card closer to the information edge when that weight is enabled', () => {
    const item = { id: 'target', anchor: { x: 150, y: 150 }, width: 40, height: 40 };
    const scenario: LayoutConfig = {
      ...config,
      canvasRect: { x: 0, y: 0, width: 300, height: 300 },
      infoRect: { x: 100, y: 100, width: 100, height: 100 },
      spacing: 0,
      weights: {
        ...config.weights,
        distance: 0,
        stability: 0,
        anchorOcclusion: 0,
        lineIntersection: 0,
        lineOcclusion: 0,
        infoEdgeDistance: 0,
      },
    };
    const unweighted = calculateLayout([item], new Map(), scenario).get(item.id)!;
    const weighted = calculateLayout([item], new Map(), {
      ...scenario,
      weights: { ...scenario.weights, infoEdgeDistance: 20 },
    }).get(item.id)!;
    const unweightedConnection = getConnectionPoint(item.anchor, unweighted);
    const weightedConnection = getConnectionPoint(item.anchor, weighted);

    expect(getDistanceToRectBoundary(weightedConnection, scenario.infoRect)).toBeLessThan(
      getDistanceToRectBoundary(unweightedConnection, scenario.infoRect),
    );
  });

  it('detects only intersections with a rectangle interior', () => {
    const rect = { x: 40, y: 40, width: 20, height: 20 };
    expect(doesSegmentIntersectRectInterior({ x: 0, y: 50 }, { x: 100, y: 50 }, rect)).toBe(true);
    expect(doesSegmentIntersectRectInterior({ x: 0, y: 40 }, { x: 100, y: 40 }, rect)).toBe(false);
  });

  it('offers visible edge and corner candidates without crossing the target card', () => {
    const anchor = { x: 0, y: 50 };
    const rect = { x: 100, y: 40, width: 40, height: 20 };
    const candidates = getConnectionPointCandidates(anchor, rect);
    expect(candidates).toContainEqual({ x: 100, y: 50 });
    expect(candidates).toContainEqual({ x: 100, y: 40 });
    expect(candidates).not.toContainEqual({ x: 140, y: 50 });
  });

  it('chooses a longer edge point when the nearest line is obscured by another card', () => {
    const anchor = { x: 0, y: 50 };
    const rect = { x: 100, y: 30, width: 40, height: 40 };
    const blocker = { x: 40, y: 47, width: 40, height: 6 };
    const point = getBestConnectionPoint(anchor, rect, [blocker], [], config.weights);
    expect(point).not.toEqual({ x: 100, y: 50 });
    expect(doesSegmentIntersectRectInterior(anchor, point, blocker)).toBe(false);
  });

  it('moves a card when line occlusion outweighs the shorter connection', () => {
    const blocker = { id: 'blocker', anchor: { x: 150, y: 100 }, width: 40, height: 60 };
    const target = { id: 'target', anchor: { x: 195, y: 100 }, width: 60, height: 40 };
    const previous = new Map<string, Rect>([
      ['blocker', { x: 200, y: 70, width: 40, height: 60 }],
    ]);
    const scenario: LayoutConfig = {
      ...config,
      canvasRect: { x: 0, y: 0, width: 300, height: 200 },
      infoRect: { x: 100, y: 50, width: 100, height: 100 },
      spacing: 0,
      weights: {
        ...config.weights,
        distance: 1,
        lineIntersection: 0,
        lineOcclusion: 0,
        infoEdgeDistance: 0,
      },
    };

    const unpenalized = calculateLayout([blocker, target], previous, scenario).get('target')!;
    const penalized = calculateLayout([blocker, target], previous, {
      ...scenario,
      weights: { ...scenario.weights, lineOcclusion: 40_000 },
    }).get('target')!;
    const blockerRect = previous.get('blocker')!;
    const unpenalizedConnection = getBestConnectionPoint(
      target.anchor,
      unpenalized,
      [blockerRect],
      [],
      scenario.weights,
    );
    const penalizedConnection = getBestConnectionPoint(
      target.anchor,
      penalized,
      [blockerRect],
      [],
      { ...scenario.weights, lineOcclusion: 40_000 },
    );

    expect(unpenalized.x).toBe(240);
    expect(doesSegmentIntersectRectInterior(
      target.anchor,
      unpenalizedConnection,
      blockerRect,
    )).toBe(true);
    expect(penalized).not.toEqual(unpenalized);
    expect(doesSegmentIntersectRectInterior(
      target.anchor,
      penalizedConnection,
      blockerRect,
    )).toBe(false);
  });

  it('chooses the largest scale that satisfies every hard constraint', () => {
    const compactConfig: LayoutConfig = {
      ...config,
      canvasRect: { x: 0, y: 0, width: 200, height: 100 },
      infoRect: { x: 60, y: 0, width: 80, height: 100 },
      spacing: 0,
    };
    const items: LayoutInput[] = [
      { id: 'left', anchor: { x: 90, y: 50 }, width: 100, height: 100 },
      { id: 'right', anchor: { x: 110, y: 50 }, width: 100, height: 100 },
    ];
    const result = calculateFittingLayout(items, new Map(), {
      minScale: 0.5,
      scaleStep: 0.25,
      getConfig: () => compactConfig,
    });

    expect(createScaleCandidates(0.5, 0.25)).toEqual([1, 0.75, 0.5]);
    expect(result.scale).toBe(0.5);
    expect(result.satisfiesHardConstraints).toBe(true);
    expect(layoutSatisfiesHardConstraints(result.inputs, result.layout, compactConfig)).toBe(true);
  });
});
