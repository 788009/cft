export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutInput {
  id: string;
  anchor: Point;
  width: number;
  height: number;
}

export interface LayoutConfig {
  canvasRect: Rect;
  infoRect: Rect;
  obstacles: Rect[];
  spacing: number;
  weights: {
    overlap: number;
    outOfBounds: number;
    anchorOcclusion: number;
    lineIntersection: number;
    distance: number;
    stability: number;
  };
}

export function isOverlap(r1: Rect, r2: Rect, spacing: number): boolean {
  return !(
    r1.x + r1.width + spacing <= r2.x ||
    r2.x + r2.width + spacing <= r1.x ||
    r1.y + r1.height + spacing <= r2.y ||
    r2.y + r2.height + spacing <= r1.y
  );
}

export function isInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function doSegmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const ccw = (a: Point, b: Point, c: Point) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function getConnectionPoint(anchor: Point, rect: Rect): Point {
  const clampedX = Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width));
  const clampedY = Math.max(rect.y, Math.min(anchor.y, rect.y + rect.height));

  if (
    anchor.x < rect.x ||
    anchor.x > rect.x + rect.width ||
    anchor.y < rect.y ||
    anchor.y > rect.y + rect.height
  ) {
    return { x: clampedX, y: clampedY };
  }

  const edges = [
    { distance: anchor.x - rect.x, point: { x: rect.x, y: anchor.y } },
    { distance: rect.x + rect.width - anchor.x, point: { x: rect.x + rect.width, y: anchor.y } },
    { distance: anchor.y - rect.y, point: { x: anchor.x, y: rect.y } },
    { distance: rect.y + rect.height - anchor.y, point: { x: anchor.x, y: rect.y + rect.height } },
  ];
  edges.sort((a, b) => a.distance - b.distance);
  return edges[0].point;
}

function violatesHardConstraints(rect: Rect, placedRects: Rect[], config: LayoutConfig): boolean {
  return (
    !isInside(rect, config.canvasRect) ||
    isOverlap(rect, config.infoRect, 0) ||
    placedRects.some((placed) => isOverlap(rect, placed, config.spacing)) ||
    config.obstacles.some((obstacle) => isOverlap(rect, obstacle, config.spacing))
  );
}

function hardConstraintCost(rect: Rect, placedRects: Rect[], config: LayoutConfig): number {
  let cost = 0;
  if (!isInside(rect, config.canvasRect)) cost += config.weights.outOfBounds;
  if (isOverlap(rect, config.infoRect, 0)) cost += config.weights.overlap;
  if (placedRects.some((placed) => isOverlap(rect, placed, config.spacing))) {
    cost += config.weights.overlap;
  }
  if (config.obstacles.some((obstacle) => isOverlap(rect, obstacle, config.spacing))) {
    cost += config.weights.overlap;
  }
  return cost;
}

function candidatePoints(item: LayoutInput, config: LayoutConfig): Point[] {
  const step = Math.max(16, config.spacing * 2);
  const maximumX = config.canvasRect.x + config.canvasRect.width - item.width;
  const maximumY = config.canvasRect.y + config.canvasRect.height - item.height;
  const xValues: number[] = [];
  const yValues: number[] = [];

  for (let x = config.canvasRect.x; x <= maximumX; x += step) xValues.push(x);
  for (let y = config.canvasRect.y; y <= maximumY; y += step) yValues.push(y);
  if (xValues.at(-1) !== maximumX) xValues.push(maximumX);
  if (yValues.at(-1) !== maximumY) yValues.push(maximumY);

  return xValues.flatMap((x) => yValues.map((y) => ({ x, y })));
}

function softCost(
  item: LayoutInput,
  rect: Rect,
  previousRect: Rect | undefined,
  items: LayoutInput[],
  lines: { start: Point; end: Point }[],
  config: LayoutConfig,
): number {
  const connection = getConnectionPoint(item.anchor, rect);
  const distance = Math.hypot(connection.x - item.anchor.x, connection.y - item.anchor.y);
  let cost = distance * config.weights.distance;

  if (previousRect) {
    cost += Math.hypot(rect.x - previousRect.x, rect.y - previousRect.y) * config.weights.stability;
  }

  const intersections = lines.filter((line) => (
    doSegmentsIntersect(connection, item.anchor, line.start, line.end)
  )).length;
  cost += intersections * config.weights.lineIntersection;

  const occlusions = items.filter((otherItem) => (
    otherItem.anchor.x >= rect.x - config.spacing &&
    otherItem.anchor.x <= rect.x + rect.width + config.spacing &&
    otherItem.anchor.y >= rect.y - config.spacing &&
    otherItem.anchor.y <= rect.y + rect.height + config.spacing
  )).length;

  return cost + occlusions * config.weights.anchorOcclusion;
}

export function calculateLayout(
  items: LayoutInput[],
  previousLayout: Map<string, Rect>,
  config: LayoutConfig
): Map<string, Rect> {
  const result = new Map<string, Rect>();
  const lines: { start: Point; end: Point }[] = [];
  const placedRects: Rect[] = [];

  // 优先级：先放置之前存在的学校，再放置新出现的学校
  const sortedItems = [...items].sort((a, b) => {
    const hasA = previousLayout.has(a.id) ? 1 : 0;
    const hasB = previousLayout.has(b.id) ? 1 : 0;
    if (hasA !== hasB) return hasB - hasA;
    if (hasA === 0) return b.width * b.height - a.width * a.height;
    return 0;
  });

  for (const item of sortedItems) {
    const prevRect = previousLayout.get(item.id);
    const restoredRect = prevRect
      ? { x: prevRect.x, y: prevRect.y, width: item.width, height: item.height }
      : null;
    let bestRect = restoredRect && !violatesHardConstraints(restoredRect, placedRects, config)
      ? restoredRect
      : null;

    let candidates: Rect[] = [];

    if (!bestRect) {
      candidates = candidatePoints(item, config).map((point) => ({
        x: point.x,
        y: point.y,
        width: item.width,
        height: item.height,
      }));
      let minimumCost = Infinity;
      for (const rect of candidates) {
        if (violatesHardConstraints(rect, placedRects, config)) continue;
        const cost = softCost(item, rect, prevRect, items, lines, config);
        if (cost < minimumCost) {
          minimumCost = cost;
          bestRect = rect;
        }
      }
    }

    if (!bestRect) {
      let minimumCost = Infinity;
      for (const rect of restoredRect ? [restoredRect, ...candidates] : candidates) {
        const cost = hardConstraintCost(rect, placedRects, config) +
          softCost(item, rect, prevRect, items, lines, config);
        if (cost < minimumCost) {
          minimumCost = cost;
          bestRect = rect;
        }
      }
    }

    if (bestRect) {
      result.set(item.id, bestRect);
      placedRects.push(bestRect);
      lines.push({
        start: getConnectionPoint(item.anchor, bestRect),
        end: item.anchor,
      });
    }
  }

  return result;
}
