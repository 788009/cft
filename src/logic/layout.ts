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

export function calculateLayout(
  items: LayoutInput[],
  previousLayout: Map<string, Rect>,
  config: LayoutConfig
): Map<string, Rect> {
  const result = new Map<string, Rect>();
  const lines: { start: Point; end: Point }[] = [];
  const placedRects: Rect[] = [];

  // 生成候选点（使用特定步长生成画布内的网格点）
  const step = Math.max(20, config.spacing * 2);
  const candidates: Point[] = [];
  for (let x = config.canvasRect.x; x <= config.canvasRect.x + config.canvasRect.width; x += step) {
    for (let y = config.canvasRect.y; y <= config.canvasRect.y + config.canvasRect.height; y += step) {
      candidates.push({ x, y });
    }
  }

  // 优先级：先放置之前存在的学校，再放置新出现的学校
  const sortedItems = [...items].sort((a, b) => {
    const hasA = previousLayout.has(a.id) ? 1 : 0;
    const hasB = previousLayout.has(b.id) ? 1 : 0;
    return hasB - hasA;
  });

  for (const item of sortedItems) {
    let bestRect: Rect | null = null;
    let minCost = Infinity;

    const prevRect = previousLayout.get(item.id);
    const itemCandidates = prevRect ? [{ x: prevRect.x, y: prevRect.y }, ...candidates] : candidates;

    for (const cand of itemCandidates) {
      const rect: Rect = { x: cand.x, y: cand.y, width: item.width, height: item.height };
      let cost = 0;

      // 1. 硬约束：超出可用画布
      if (!isInside(rect, config.canvasRect)) {
        cost += config.weights.outOfBounds;
      }

      // 2. 硬约束：与已有标签重叠
      for (const pr of placedRects) {
        if (isOverlap(rect, pr, config.spacing)) {
          cost += config.weights.overlap;
          break;
        }
      }

      // 3. 硬约束：必须在信息矩形之外（标签不能遮挡中间的矩形区）
      if (isOverlap(rect, config.infoRect, 0)) {
        cost += config.weights.overlap; 
      }

      // 若硬约束已超标且不是唯一的选择，可以直接跳过计算以优化性能，但为了兜底此处累加
      if (cost >= config.weights.overlap && minCost < config.weights.overlap) {
        continue;
      }

      // 4. 软约束：连线距离代价
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const dist = Math.sqrt(Math.pow(center.x - item.anchor.x, 2) + Math.pow(center.y - item.anchor.y, 2));
      cost += dist * config.weights.distance;

      // 5. 软约束：稳定性（优先保持原位置）
      if (prevRect) {
        const stableDist = Math.sqrt(Math.pow(rect.x - prevRect.x, 2) + Math.pow(rect.y - prevRect.y, 2));
        cost += stableDist * config.weights.stability;
      } else {
        // 对于新进入的节点，增加少许基础稳定性代价，使整体算法更偏好维持老节点
        cost += 100 * config.weights.stability; 
      }

      // 6. 软约束：连线交叉
      let intersections = 0;
      for (const line of lines) {
        if (doSegmentsIntersect(center, item.anchor, line.start, line.end)) {
          intersections++;
        }
      }
      cost += intersections * config.weights.lineIntersection;

      // 7. 软约束：遮挡锚点（标签覆盖了任何一所学校的经纬度对应点）
      let occlusion = 0;
      for (const otherItem of items) {
        if (
          otherItem.anchor.x >= rect.x - config.spacing &&
          otherItem.anchor.x <= rect.x + rect.width + config.spacing &&
          otherItem.anchor.y >= rect.y - config.spacing &&
          otherItem.anchor.y <= rect.y + rect.height + config.spacing
        ) {
          occlusion++;
        }
      }
      cost += occlusion * config.weights.anchorOcclusion;

      if (cost < minCost) {
        minCost = cost;
        bestRect = rect;
      }
    }

    if (bestRect) {
      result.set(item.id, bestRect);
      placedRects.push(bestRect);
      lines.push({
        start: { x: bestRect.x + bestRect.width / 2, y: bestRect.y + bestRect.height / 2 },
        end: item.anchor,
      });
    }
  }

  return result;
}
