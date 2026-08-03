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

export interface ArrowTarget {
  id: string;
  target: Point;
}

export interface ArrowGroup {
  x: number;
  y: number;
  angle: number;
  count: number;
  ids: string[];
}

export function getRayIntersection(center: Point, target: Point, rect: Rect): Point | null {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  
  if (dx === 0 && dy === 0) {
    return null;
  }

  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  let tMin = Infinity;
  let intersectX = center.x;
  let intersectY = center.y;

  if (dx !== 0) {
    const t1 = (left - center.x) / dx;
    if (t1 > 0 && t1 < tMin) {
      const y = center.y + t1 * dy;
      if (y >= top && y <= bottom) {
        tMin = t1;
        intersectX = left;
        intersectY = y;
      }
    }
    const t2 = (right - center.x) / dx;
    if (t2 > 0 && t2 < tMin) {
      const y = center.y + t2 * dy;
      if (y >= top && y <= bottom) {
        tMin = t2;
        intersectX = right;
        intersectY = y;
      }
    }
  }

  if (dy !== 0) {
    const t3 = (top - center.y) / dy;
    if (t3 > 0 && t3 < tMin) {
      const x = center.x + t3 * dx;
      if (x >= left && x <= right) {
        tMin = t3;
        intersectX = x;
        intersectY = top;
      }
    }
    const t4 = (bottom - center.y) / dy;
    if (t4 > 0 && t4 < tMin) {
      const x = center.x + t4 * dx;
      if (x >= left && x <= right) {
        tMin = t4;
        intersectX = x;
        intersectY = bottom;
      }
    }
  }

  if (tMin === Infinity) {
    return null;
  }

  return { x: intersectX, y: intersectY };
}

export function calculateArrows(
  center: Point,
  rect: Rect,
  targets: ArrowTarget[],
  mergeDistance: number
): ArrowGroup[] {
  const arrows = targets
    .map((t) => {
      const p = getRayIntersection(center, t.target, rect);
      if (!p) return null;
      const angle = Math.atan2(t.target.y - center.y, t.target.x - center.x);
      return { id: t.id, x: p.x, y: p.y, angle };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const groups: ArrowGroup[] = [];

  for (let i = 0; i < arrows.length; i++) {
    const arrow = arrows[i];
    let merged = false;

    for (let j = 0; j < groups.length; j++) {
      const g = groups[j];
      const dist = Math.sqrt(Math.pow(g.x - arrow.x, 2) + Math.pow(g.y - arrow.y, 2));

      if (dist <= mergeDistance) {
        g.ids.push(arrow.id);
        g.count += 1;

        const sumX = Math.cos(g.angle) * (g.count - 1) + Math.cos(arrow.angle);
        const sumY = Math.sin(g.angle) * (g.count - 1) + Math.sin(arrow.angle);
        g.angle = Math.atan2(sumY, sumX);

        g.x = (g.x * (g.count - 1) + arrow.x) / g.count;
        g.y = (g.y * (g.count - 1) + arrow.y) / g.count;

        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({
        x: arrow.x,
        y: arrow.y,
        angle: arrow.angle,
        count: 1,
        ids: [arrow.id],
      });
    }
  }

  return groups;
}
