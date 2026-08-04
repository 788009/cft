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
    directionAlignment: number;
    lineIntersection: number;
    lineOcclusion: number;
    infoEdgeDistance: number;
    distance: number;
    stability: number;
  };
}

export interface FittingLayoutResult {
  scale: number;
  inputs: LayoutInput[];
  layout: Map<string, Rect>;
  connections: Map<string, Point>;
  score: LayoutScore;
  config: LayoutConfig;
  satisfiesHardConstraints: boolean;
}

export interface LayoutScore {
  hardViolations: number;
  lineOcclusions: number;
  lineIntersections: number;
  anchorOcclusions: number;
  directionCost: number;
  stabilityCost: number;
  distanceCost: number;
}

export interface CardConflictDiagnostic {
  id: string;
  lineOcclusions: number;
  coveredLines: number;
  lineIntersections: number;
  anchorOcclusions: number;
  directionCost: number;
  relatedIds: Set<string>;
}

export interface LayoutEvaluation {
  layout: Map<string, Rect>;
  connections: Map<string, Point>;
  score: LayoutScore;
  diagnostics: Map<string, CardConflictDiagnostic>;
}

export interface LayoutOptimizationOptions {
  maxPasses?: number;
  maxAcceptedMoves?: number;
  localOffsets?: number[];
  globalCandidateLimit?: number;
}

export interface FittingLayoutOptions {
  minScale: number;
  scaleStep: number;
  getConfig: (scale: number) => LayoutConfig;
  isScaleAllowed?: (scale: number) => boolean;
  optimize?: boolean;
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

export function getDistanceToRectBoundary(point: Point, rect: Rect): number {
  const clampedX = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const clampedY = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  const outsideDistance = Math.hypot(point.x - clampedX, point.y - clampedY);
  if (outsideDistance > 0) return outsideDistance;
  return Math.min(
    point.x - rect.x,
    rect.x + rect.width - point.x,
    point.y - rect.y,
    rect.y + rect.height - point.y,
  );
}

export function createScaleCandidates(minScale: number, step: number): number[] {
  const clampedMinimum = Math.min(1, Math.max(0.01, minScale));
  const safeStep = Math.min(1, Math.max(0.01, step));
  const scales = [1];
  for (let scale = 1 - safeStep; scale > clampedMinimum; scale -= safeStep) {
    scales.push(Number(scale.toFixed(4)));
  }
  if (scales.at(-1) !== clampedMinimum) scales.push(clampedMinimum);
  return scales;
}

export function scaleLayoutInputs(items: LayoutInput[], scale: number): LayoutInput[] {
  return items.map((item) => ({
    ...item,
    width: item.width * scale,
    height: item.height * scale,
  }));
}

export function layoutSatisfiesHardConstraints(
  items: LayoutInput[],
  layout: Map<string, Rect>,
  config: LayoutConfig,
): boolean {
  if (layout.size !== items.length) return false;
  const placed: Rect[] = [];
  for (const item of items) {
    const rect = layout.get(item.id);
    if (!rect || violatesHardConstraints(rect, placed, config)) return false;
    placed.push(rect);
  }
  return true;
}

function doSegmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const ccw = (a: Point, b: Point, c: Point) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export interface ConnectionLine {
  start: Point;
  end: Point;
}

export function doesSegmentIntersectRectInterior(
  start: Point,
  end: Point,
  rect: Rect,
): boolean {
  const epsilon = 0.01;
  const left = rect.x + epsilon;
  const right = rect.x + rect.width - epsilon;
  const top = rect.y + epsilon;
  const bottom = rect.y + rect.height - epsilon;
  if (left >= right || top >= bottom) return false;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimumT = 0;
  let maximumT = 1;
  const clipAxis = (origin: number, delta: number, minimum: number, maximum: number): boolean => {
    if (Math.abs(delta) < Number.EPSILON) return origin >= minimum && origin <= maximum;
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    minimumT = Math.max(minimumT, Math.min(first, second));
    maximumT = Math.min(maximumT, Math.max(first, second));
    return minimumT <= maximumT;
  };

  return clipAxis(start.x, dx, left, right) && clipAxis(start.y, dy, top, bottom);
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

export function getConnectionPointCandidates(anchor: Point, rect: Rect): Point[] {
  const clampedX = Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width));
  const clampedY = Math.max(rect.y, Math.min(anchor.y, rect.y + rect.height));
  const points: Point[] = [
    getConnectionPoint(anchor, rect),
    { x: rect.x, y: clampedY },
    { x: rect.x + rect.width, y: clampedY },
    { x: clampedX, y: rect.y },
    { x: clampedX, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 2, y: rect.y },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height },
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x},${point.y}`;
    if (seen.has(key) || doesSegmentIntersectRectInterior(anchor, point, rect)) return false;
    seen.add(key);
    return true;
  });
}

function getRectDiagonal(rect: Rect): number {
  return Math.max(1, Math.hypot(rect.width, rect.height));
}

function getLinearDistanceCost(distance: number, weight: number, normalizationLength: number): number {
  if (weight === 0) return 0;
  return distance / Math.max(1, normalizationLength) * weight;
}

export function getDistanceCost(
  start: Point,
  end: Point,
  weight: number,
  normalizationLength = 1,
): number {
  if (weight === 0) return 0;
  const normalizedDistance = Math.hypot(end.x - start.x, end.y - start.y) /
    Math.max(1, normalizationLength);
  return normalizedDistance ** 2 * weight;
}

export function getDirectionAlignmentCost(
  anchor: Point,
  rect: Rect,
  infoRect: Rect,
  weight: number,
): number {
  if (weight === 0) return 0;
  const centerX = infoRect.x + infoRect.width / 2;
  const centerY = infoRect.y + infoRect.height / 2;
  const anchorX = anchor.x - centerX;
  const anchorY = anchor.y - centerY;
  const cardX = rect.x + rect.width / 2 - centerX;
  const cardY = rect.y + rect.height / 2 - centerY;
  const anchorLength = Math.hypot(anchorX, anchorY);
  const cardLength = Math.hypot(cardX, cardY);
  if (anchorLength === 0 || cardLength === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (
    anchorX * cardX + anchorY * cardY
  ) / (anchorLength * cardLength)));
  return (1 - cosine) / 2 * weight;
}

export function getBestConnectionPoint(
  anchor: Point,
  rect: Rect,
  obstacles: Rect[],
  lines: ConnectionLine[],
  weights: Pick<
    LayoutConfig['weights'],
    'distance' | 'lineIntersection' | 'lineOcclusion' | 'infoEdgeDistance'
  >,
  infoRect?: Rect,
  canvasRect?: Rect,
): Point {
  const candidates = getConnectionPointCandidates(anchor, rect);
  let bestPoint = candidates[0] ?? getConnectionPoint(anchor, rect);
  let bestCost = Infinity;
  const distanceNormalization = weights.distance !== 0 && canvasRect
    ? getRectDiagonal(canvasRect)
    : 1;
  const infoEdgeNormalization = weights.infoEdgeDistance !== 0 && infoRect
    ? Math.max(1, Math.min(infoRect.width, infoRect.height))
    : 1;
  for (const point of candidates) {
    const intersections = weights.lineIntersection === 0
      ? 0
      : lines.filter((line) => (
        doSegmentsIntersect(point, anchor, line.start, line.end)
      )).length;
    const occlusions = weights.lineOcclusion === 0
      ? 0
      : obstacles.filter((obstacle) => (
        doesSegmentIntersectRectInterior(anchor, point, obstacle)
      )).length;
    const cost = (weights.distance === 0
      ? 0
      : getDistanceCost(anchor, point, weights.distance, distanceNormalization)) +
      intersections * weights.lineIntersection + occlusions * weights.lineOcclusion +
      (infoRect && weights.infoEdgeDistance !== 0
        ? getLinearDistanceCost(
          getDistanceToRectBoundary(point, infoRect),
          weights.infoEdgeDistance,
          infoEdgeNormalization,
        )
        : 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestPoint = point;
    }
  }
  return bestPoint;
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
  if (config.weights.outOfBounds !== 0 && !isInside(rect, config.canvasRect)) {
    cost += config.weights.outOfBounds;
  }
  if (config.weights.overlap !== 0) {
    if (isOverlap(rect, config.infoRect, 0)) cost += config.weights.overlap;
    if (placedRects.some((placed) => isOverlap(rect, placed, config.spacing))) {
      cost += config.weights.overlap;
    }
    if (config.obstacles.some((obstacle) => isOverlap(rect, obstacle, config.spacing))) {
      cost += config.weights.overlap;
    }
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
  lines: ConnectionLine[],
  placedRects: Rect[],
  config: LayoutConfig,
): number {
  const connection = getBestConnectionPoint(
    item.anchor,
    rect,
    config.weights.lineOcclusion === 0 ? [] : [...placedRects, ...config.obstacles],
    config.weights.lineIntersection === 0 ? [] : lines,
    config.weights,
    config.infoRect,
    config.canvasRect,
  );
  const canvasDiagonal = config.weights.distance !== 0 || config.weights.stability !== 0
    ? getRectDiagonal(config.canvasRect)
    : 1;
  const infoEdgeNormalization = config.weights.infoEdgeDistance === 0
    ? 1
    : Math.max(1, Math.min(config.infoRect.width, config.infoRect.height));
  let cost = config.weights.distance === 0
    ? 0
    : getDistanceCost(item.anchor, connection, config.weights.distance, canvasDiagonal);
  if (config.weights.infoEdgeDistance !== 0) {
    cost += getLinearDistanceCost(
      getDistanceToRectBoundary(connection, config.infoRect),
      config.weights.infoEdgeDistance,
      infoEdgeNormalization,
    );
  }
  cost += getDirectionAlignmentCost(
    item.anchor,
    rect,
    config.infoRect,
    config.weights.directionAlignment,
  );

  if (previousRect && config.weights.stability !== 0) {
    cost += getLinearDistanceCost(
      Math.hypot(rect.x - previousRect.x, rect.y - previousRect.y),
      config.weights.stability,
      canvasDiagonal,
    );
  }

  if (config.weights.lineIntersection !== 0) {
    const intersections = lines.filter((line) => (
      doSegmentsIntersect(connection, item.anchor, line.start, line.end)
    )).length;
    cost += intersections * config.weights.lineIntersection;
  }
  if (config.weights.lineOcclusion !== 0) {
    const lineOcclusions = [...placedRects, ...config.obstacles].filter((obstacle) => (
      doesSegmentIntersectRectInterior(item.anchor, connection, obstacle)
    )).length;
    const coveredLines = lines.filter((line) => (
      doesSegmentIntersectRectInterior(line.start, line.end, rect)
    )).length;
    cost += (lineOcclusions + coveredLines) * config.weights.lineOcclusion;
  }
  if (config.weights.anchorOcclusion !== 0) {
    const occlusions = items.filter((otherItem) => (
      otherItem.anchor.x >= rect.x - config.spacing &&
      otherItem.anchor.x <= rect.x + rect.width + config.spacing &&
      otherItem.anchor.y >= rect.y - config.spacing &&
      otherItem.anchor.y <= rect.y + rect.height + config.spacing
    )).length;
    cost += occlusions * config.weights.anchorOcclusion;
  }
  return cost;
}

export function calculateLayout(
  items: LayoutInput[],
  previousLayout: Map<string, Rect>,
  config: LayoutConfig
): Map<string, Rect> {
  const result = new Map<string, Rect>();
  const lines: ConnectionLine[] = [];
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
        const cost = softCost(item, rect, prevRect, items, lines, placedRects, config);
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
          softCost(item, rect, prevRect, items, lines, placedRects, config);
        if (cost < minimumCost) {
          minimumCost = cost;
          bestRect = rect;
        }
      }
    }

    if (bestRect) {
      result.set(item.id, bestRect);
      placedRects.push(bestRect);
      const connection = getBestConnectionPoint(
        item.anchor,
        bestRect,
        config.weights.lineOcclusion === 0
          ? []
          : [...placedRects.slice(0, -1), ...config.obstacles],
        config.weights.lineIntersection === 0 ? [] : lines,
        config.weights,
        config.infoRect,
        config.canvasRect,
      );
      lines.push({
        start: connection,
        end: item.anchor,
      });
    }
  }

  return result;
}

function compareLayoutScores(left: LayoutScore, right: LayoutScore): number {
  const leftValues = [
    left.hardViolations,
    left.lineOcclusions,
    left.lineIntersections,
    left.anchorOcclusions,
    left.directionCost,
    left.stabilityCost,
    left.distanceCost,
  ];
  const rightValues = [
    right.hardViolations,
    right.lineOcclusions,
    right.lineIntersections,
    right.anchorOcclusions,
    right.directionCost,
    right.stabilityCost,
    right.distanceCost,
  ];
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) return leftValues[index] - rightValues[index];
  }
  return 0;
}

function countHardViolations(
  items: LayoutInput[],
  layout: Map<string, Rect>,
  config: LayoutConfig,
): number {
  let violations = items.filter((item) => !layout.has(item.id)).length;
  const rects = items.flatMap((item) => {
    const rect = layout.get(item.id);
    if (!rect) return [];
    if (!isInside(rect, config.canvasRect)) violations += 1;
    if (isOverlap(rect, config.infoRect, 0)) violations += 1;
    violations += config.obstacles.filter((obstacle) => (
      isOverlap(rect, obstacle, config.spacing)
    )).length;
    return [{ id: item.id, rect }];
  });
  for (let index = 0; index < rects.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < rects.length; otherIndex += 1) {
      if (isOverlap(rects[index].rect, rects[otherIndex].rect, config.spacing)) violations += 1;
    }
  }
  return violations;
}

function getConnectionLines(
  items: LayoutInput[],
  connections: Map<string, Point>,
): Array<ConnectionLine & { id: string }> {
  return items.flatMap((item) => {
    const start = connections.get(item.id);
    return start ? [{ id: item.id, start, end: item.anchor }] : [];
  });
}

function reselectConnections(
  items: LayoutInput[],
  layout: Map<string, Rect>,
  config: LayoutConfig,
  initial?: Map<string, Point>,
  affectedIds?: Set<string>,
): Map<string, Point> {
  const connections = new Map<string, Point>();
  for (const item of items) {
    const rect = layout.get(item.id);
    if (!rect) continue;
    connections.set(item.id, initial?.get(item.id) ?? getConnectionPoint(item.anchor, rect));
  }

  const passCount = config.weights.lineIntersection === 0 ? 1 : 2;
  for (let pass = 0; pass < passCount; pass += 1) {
    for (const item of items) {
      if (affectedIds && !affectedIds.has(item.id)) continue;
      const rect = layout.get(item.id);
      if (!rect) continue;
      const obstacles = config.weights.lineOcclusion === 0
        ? []
        : [
          ...items.flatMap((other) => {
            if (other.id === item.id) return [];
            const otherRect = layout.get(other.id);
            return otherRect ? [otherRect] : [];
          }),
          ...config.obstacles,
        ];
      const lines = config.weights.lineIntersection === 0
        ? []
        : getConnectionLines(items, connections)
          .filter((line) => line.id !== item.id)
          .map(({ start, end }) => ({ start, end }));
      connections.set(item.id, getBestConnectionPoint(
        item.anchor,
        rect,
        obstacles,
        lines,
        config.weights,
        config.infoRect,
        config.canvasRect,
      ));
    }
  }
  return connections;
}

export function evaluateLayout(
  items: LayoutInput[],
  layout: Map<string, Rect>,
  previousLayout: Map<string, Rect>,
  config: LayoutConfig,
  connections = reselectConnections(items, layout, config),
): LayoutEvaluation {
  const diagnostics = new Map(items.map((item) => [item.id, {
    id: item.id,
    lineOcclusions: 0,
    coveredLines: 0,
    lineIntersections: 0,
    anchorOcclusions: 0,
    directionCost: 0,
    relatedIds: new Set<string>(),
  }]));
  const score: LayoutScore = {
    hardViolations: countHardViolations(items, layout, config),
    lineOcclusions: 0,
    lineIntersections: 0,
    anchorOcclusions: 0,
    directionCost: 0,
    stabilityCost: 0,
    distanceCost: 0,
  };
  const lines = getConnectionLines(items, connections);
  const canvasDiagonal = config.weights.distance !== 0 || config.weights.stability !== 0
    ? getRectDiagonal(config.canvasRect)
    : 1;

  for (const line of lines) {
    if (config.weights.distance !== 0) {
      score.distanceCost += getDistanceCost(
        line.start,
        line.end,
        config.weights.distance,
        canvasDiagonal,
      );
    }
    if (config.weights.lineOcclusion !== 0) {
      for (const other of items) {
        if (other.id === line.id) continue;
        const rect = layout.get(other.id);
        if (!rect || !doesSegmentIntersectRectInterior(line.start, line.end, rect)) continue;
        score.lineOcclusions += 1;
        diagnostics.get(line.id)!.lineOcclusions += 1;
        diagnostics.get(other.id)!.coveredLines += 1;
        diagnostics.get(line.id)!.relatedIds.add(other.id);
        diagnostics.get(other.id)!.relatedIds.add(line.id);
      }
      score.lineOcclusions += config.obstacles.filter((obstacle) => (
        doesSegmentIntersectRectInterior(line.start, line.end, obstacle)
      )).length;
    }
  }

  for (let index = 0; config.weights.lineIntersection !== 0 && index < lines.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < lines.length; otherIndex += 1) {
      const line = lines[index];
      const other = lines[otherIndex];
      if (!doSegmentsIntersect(line.start, line.end, other.start, other.end)) continue;
      score.lineIntersections += 1;
      diagnostics.get(line.id)!.lineIntersections += 1;
      diagnostics.get(other.id)!.lineIntersections += 1;
      diagnostics.get(line.id)!.relatedIds.add(other.id);
      diagnostics.get(other.id)!.relatedIds.add(line.id);
    }
  }

  for (const item of items) {
    const rect = layout.get(item.id);
    if (!rect) continue;
    const directionCost = getDirectionAlignmentCost(
      item.anchor,
      rect,
      config.infoRect,
      config.weights.directionAlignment,
    );
    score.directionCost += directionCost;
    diagnostics.get(item.id)!.directionCost = directionCost;
    const previous = previousLayout.get(item.id);
    if (previous && config.weights.stability !== 0) {
      score.stabilityCost += getLinearDistanceCost(
        Math.hypot(rect.x - previous.x, rect.y - previous.y),
        config.weights.stability,
        canvasDiagonal,
      );
    }
    if (config.weights.anchorOcclusion === 0) continue;
    for (const anchorItem of items) {
      if (
        anchorItem.anchor.x < rect.x - config.spacing ||
        anchorItem.anchor.x > rect.x + rect.width + config.spacing ||
        anchorItem.anchor.y < rect.y - config.spacing ||
        anchorItem.anchor.y > rect.y + rect.height + config.spacing
      ) continue;
      score.anchorOcclusions += 1;
      diagnostics.get(item.id)!.anchorOcclusions += 1;
    }
  }
  return { layout, connections, score, diagnostics };
}

function diagnosticSeverity(diagnostic: CardConflictDiagnostic): number {
  return diagnostic.lineOcclusions + diagnostic.coveredLines +
    diagnostic.lineIntersections + diagnostic.anchorOcclusions + diagnostic.directionCost;
}

function isCandidateRectValid(
  id: string,
  rect: Rect,
  layout: Map<string, Rect>,
  config: LayoutConfig,
): boolean {
  const otherRects = Array.from(layout).flatMap(([otherId, otherRect]) => (
    otherId === id ? [] : [otherRect]
  ));
  return !violatesHardConstraints(rect, otherRects, config);
}

function getLocalCandidates(
  item: LayoutInput,
  current: Rect,
  layout: Map<string, Rect>,
  config: LayoutConfig,
  offsets: number[],
  globalCandidateLimit: number,
): Rect[] {
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  const candidates = offsets.flatMap((offset) => directions.map(([dx, dy]) => ({
    x: current.x + dx * offset,
    y: current.y + dy * offset,
    width: item.width,
    height: item.height,
  })));
  const globalCandidates = candidatePoints(item, config)
    .map((point) => ({ ...point, width: item.width, height: item.height }))
    .filter((rect) => isCandidateRectValid(item.id, rect, layout, config));
  if (config.weights.distance !== 0) {
    globalCandidates.sort((left, right) => {
      const leftConnection = getConnectionPoint(item.anchor, left);
      const rightConnection = getConnectionPoint(item.anchor, right);
      return getDistanceCost(item.anchor, leftConnection, 1) -
        getDistanceCost(item.anchor, rightConnection, 1);
    });
  }
  const seen = new Set<string>();
  return [...candidates, ...globalCandidates.slice(0, globalCandidateLimit)].filter((rect) => {
    const key = `${rect.x},${rect.y}`;
    if (seen.has(key) || !isCandidateRectValid(item.id, rect, layout, config)) return false;
    seen.add(key);
    return true;
  });
}

function getAffectedConnectionIds(
  items: LayoutInput[],
  evaluation: LayoutEvaluation,
  nextLayout: Map<string, Rect>,
  movedIds: Set<string>,
): Set<string> {
  const affected = new Set(movedIds);
  const lines = getConnectionLines(items, evaluation.connections);
  for (const line of lines) {
    for (const movedId of movedIds) {
      const oldRect = evaluation.layout.get(movedId);
      const nextRect = nextLayout.get(movedId);
      if (
        (oldRect && doesSegmentIntersectRectInterior(line.start, line.end, oldRect)) ||
        (nextRect && doesSegmentIntersectRectInterior(line.start, line.end, nextRect))
      ) affected.add(line.id);
    }
  }
  return affected;
}

function evaluateChangedLayout(
  items: LayoutInput[],
  current: LayoutEvaluation,
  nextLayout: Map<string, Rect>,
  movedIds: Set<string>,
  previousLayout: Map<string, Rect>,
  config: LayoutConfig,
): LayoutEvaluation {
  const affected = config.weights.lineOcclusion === 0
    ? new Set(movedIds)
    : getAffectedConnectionIds(items, current, nextLayout, movedIds);
  const connections = reselectConnections(
    items,
    nextLayout,
    config,
    current.connections,
    affected,
  );
  return evaluateLayout(items, nextLayout, previousLayout, config, connections);
}

export function optimizeLayout(
  items: LayoutInput[],
  initialLayout: Map<string, Rect>,
  previousLayout: Map<string, Rect>,
  config: LayoutConfig,
  options: LayoutOptimizationOptions = {},
): LayoutEvaluation {
  const maxPasses = options.maxPasses ?? 4;
  const maxAcceptedMoves = options.maxAcceptedMoves ?? 50;
  const offsets = options.localOffsets ?? [16, 32, 48];
  const globalCandidateLimit = options.globalCandidateLimit ?? 12;
  const itemOrder = new Map(items.map((item, index) => [item.id, index]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const canMoveExisting = previousLayout.size === 0;
  let current = evaluateLayout(items, initialLayout, previousLayout, config);
  let acceptedMoves = 0;

  for (let pass = 0; pass < maxPasses && acceptedMoves < maxAcceptedMoves; pass += 1) {
    let improved = false;
    const conflicted = Array.from(current.diagnostics.values())
      .filter((diagnostic) => (
        diagnosticSeverity(diagnostic) > 0 &&
        (canMoveExisting || !previousLayout.has(diagnostic.id))
      ))
      .sort((left, right) => (
        diagnosticSeverity(right) - diagnosticSeverity(left) ||
        (itemOrder.get(left.id)! - itemOrder.get(right.id)!)
      ));

    for (const diagnostic of conflicted) {
      if (acceptedMoves >= maxAcceptedMoves) break;
      const item = itemsById.get(diagnostic.id);
      const currentRect = current.layout.get(diagnostic.id);
      if (!item || !currentRect) continue;
      let best = current;
      for (const candidate of getLocalCandidates(
        item,
        currentRect,
        current.layout,
        config,
        offsets,
        globalCandidateLimit,
      )) {
        const nextLayout = new Map(current.layout);
        nextLayout.set(item.id, candidate);
        const evaluated = evaluateChangedLayout(
          items,
          current,
          nextLayout,
          new Set([item.id]),
          previousLayout,
          config,
        );
        if (compareLayoutScores(evaluated.score, best.score) < 0) best = evaluated;
      }
      if (best === current) continue;
      current = evaluateLayout(items, best.layout, previousLayout, config);
      acceptedMoves += 1;
      improved = true;
    }

    const pairKeys = new Set<string>();
    const pairs: Array<[string, string]> = [];
    for (const diagnostic of current.diagnostics.values()) {
      if (!canMoveExisting && previousLayout.has(diagnostic.id)) continue;
      for (const otherId of diagnostic.relatedIds) {
        if (!canMoveExisting && previousLayout.has(otherId)) continue;
        const ordered = [diagnostic.id, otherId].sort((left, right) => (
          itemOrder.get(left)! - itemOrder.get(right)!
        ));
        const key = ordered.join('\u0000');
        if (pairKeys.has(key)) continue;
        pairKeys.add(key);
        pairs.push([ordered[0], ordered[1]]);
      }
    }
    for (const [leftId, rightId] of pairs) {
      if (acceptedMoves >= maxAcceptedMoves) break;
      const leftItem = itemsById.get(leftId);
      const rightItem = itemsById.get(rightId);
      const leftRect = current.layout.get(leftId);
      const rightRect = current.layout.get(rightId);
      if (!leftItem || !rightItem || !leftRect || !rightRect) continue;
      const nextLayout = new Map(current.layout);
      nextLayout.set(leftId, { x: rightRect.x, y: rightRect.y, width: leftItem.width, height: leftItem.height });
      nextLayout.set(rightId, { x: leftRect.x, y: leftRect.y, width: rightItem.width, height: rightItem.height });
      if (countHardViolations(items, nextLayout, config) !== 0) continue;
      const evaluated = evaluateChangedLayout(
        items,
        current,
        nextLayout,
        new Set([leftId, rightId]),
        previousLayout,
        config,
      );
      if (compareLayoutScores(evaluated.score, current.score) >= 0) continue;
      current = evaluateLayout(items, evaluated.layout, previousLayout, config);
      acceptedMoves += 1;
      improved = true;
    }
    if (!improved) break;
  }
  return current;
}

export function calculateFittingLayout(
  items: LayoutInput[],
  previousLayout: Map<string, Rect>,
  options: FittingLayoutOptions,
): FittingLayoutResult {
  let fallback: FittingLayoutResult | null = null;
  for (const scale of createScaleCandidates(options.minScale, options.scaleStep)) {
    const scaledInputs = scaleLayoutInputs(items, scale);
    const config = options.getConfig(scale);
    const initialLayout = calculateLayout(scaledInputs, previousLayout, config);
    const optimized = options.optimize
      ? optimizeLayout(scaledInputs, initialLayout, previousLayout, config)
      : evaluateLayout(scaledInputs, initialLayout, previousLayout, config);
    const layout = optimized.layout;
    const satisfiesHardConstraints = (
      (options.isScaleAllowed?.(scale) ?? true) &&
      layoutSatisfiesHardConstraints(scaledInputs, layout, config)
    );
    const result = {
      scale,
      inputs: scaledInputs,
      layout,
      connections: optimized.connections,
      score: optimized.score,
      config,
      satisfiesHardConstraints,
    };
    fallback = result;
    if (satisfiesHardConstraints) return result;
  }
  return fallback ?? {
    scale: 1,
    inputs: [],
    layout: new Map<string, Rect>(),
    connections: new Map<string, Point>(),
    score: {
      hardViolations: 0,
      lineOcclusions: 0,
      lineIntersections: 0,
      anchorOcclusions: 0,
      directionCost: 0,
      stabilityCost: 0,
      distanceCost: 0,
    },
    config: options.getConfig(1),
    satisfiesHardConstraints: true,
  };
}
