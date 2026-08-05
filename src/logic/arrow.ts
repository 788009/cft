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

export type RectEdge = 'top' | 'right' | 'bottom' | 'left';

export interface ArrowTarget {
  id: string;
  target: Point;
}

export interface ArrowGroup {
  x: number;
  y: number;
  angle: number;
  edge: RectEdge;
  count: number;
  ids: string[];
}

interface EdgeIntersection extends Point {
  edge: RectEdge;
}

interface PositionedArrow extends EdgeIntersection {
  id: string;
  angle: number;
}

function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function getRayEdgeIntersection(
  center: Point,
  target: Point,
  rect: Rect,
): EdgeIntersection | null {
  if (containsPoint(rect, target)) return null;
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return null;

  const candidates: Array<EdgeIntersection & { distance: number }> = [];
  const addCandidate = (distance: number, edge: RectEdge): void => {
    if (distance <= 0) return;
    const x = center.x + distance * dx;
    const y = center.y + distance * dy;
    const withinHorizontal = x >= rect.x && x <= rect.x + rect.width;
    const withinVertical = y >= rect.y && y <= rect.y + rect.height;
    if (
      (edge === 'top' || edge === 'bottom' ? withinHorizontal : withinVertical)
    ) candidates.push({ x, y, edge, distance });
  };

  if (dx !== 0) {
    addCandidate((rect.x - center.x) / dx, 'left');
    addCandidate((rect.x + rect.width - center.x) / dx, 'right');
  }
  if (dy !== 0) {
    addCandidate((rect.y - center.y) / dy, 'top');
    addCandidate((rect.y + rect.height - center.y) / dy, 'bottom');
  }
  const intersection = candidates.sort((left, right) => left.distance - right.distance)[0];
  return intersection
    ? { x: intersection.x, y: intersection.y, edge: intersection.edge }
    : null;
}

export function getRayIntersection(center: Point, target: Point, rect: Rect): Point | null {
  const intersection = getRayEdgeIntersection(center, target, rect);
  return intersection ? { x: intersection.x, y: intersection.y } : null;
}

function edgePosition(arrow: PositionedArrow): number {
  return arrow.edge === 'top' || arrow.edge === 'bottom' ? arrow.x : arrow.y;
}

function createGroup(arrows: PositionedArrow[]): ArrowGroup {
  const count = arrows.length;
  const sumCos = arrows.reduce((sum, arrow) => sum + Math.cos(arrow.angle), 0);
  const sumSin = arrows.reduce((sum, arrow) => sum + Math.sin(arrow.angle), 0);
  return {
    x: arrows.reduce((sum, arrow) => sum + arrow.x, 0) / count,
    y: arrows.reduce((sum, arrow) => sum + arrow.y, 0) / count,
    angle: Math.atan2(sumSin, sumCos),
    edge: arrows[0].edge,
    count,
    ids: arrows.map((arrow) => arrow.id),
  };
}

export function calculateArrows(
  center: Point,
  rect: Rect,
  targets: ArrowTarget[],
  mergeDistance: number,
): ArrowGroup[] {
  const arrows = targets.flatMap((target): PositionedArrow[] => {
    const intersection = getRayEdgeIntersection(center, target.target, rect);
    return intersection ? [{
      id: target.id,
      ...intersection,
      angle: Math.atan2(target.target.y - center.y, target.target.x - center.x),
    }] : [];
  });
  const groups: ArrowGroup[] = [];
  const edgeOrder: RectEdge[] = ['top', 'right', 'bottom', 'left'];

  for (const edge of edgeOrder) {
    const edgeArrows = arrows
      .filter((arrow) => arrow.edge === edge)
      .sort((left, right) => (
        edgePosition(left) - edgePosition(right) || left.id.localeCompare(right.id)
      ));
    let cluster: PositionedArrow[] = [];
    for (const arrow of edgeArrows) {
      const first = cluster[0];
      if (first && edgePosition(arrow) - edgePosition(first) > mergeDistance) {
        groups.push(createGroup(cluster));
        cluster = [];
      }
      cluster.push(arrow);
    }
    if (cluster.length > 0) groups.push(createGroup(cluster));
  }

  return groups;
}
