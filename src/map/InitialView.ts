import type { Point, Rect } from '@/logic/layout';

export interface InitialMapTransform {
  x: number;
  y: number;
  k: number;
}

export function calculateInitialMapTransform(
  points: Point[],
  viewport: { width: number; height: number },
  infoRectangle: Rect,
  extentRatio: number,
): InitialMapTransform {
  if (points.length === 0) return { x: 0, y: 0, k: 1 };

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scaleX = spanX > 0 ? infoRectangle.width * extentRatio / spanX : Infinity;
  const scaleY = spanY > 0 ? infoRectangle.height * extentRatio / spanY : Infinity;
  const fittedScale = Math.min(scaleX, scaleY);
  const k = Number.isFinite(fittedScale) && fittedScale > 0 ? fittedScale : 1;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    x: viewport.width / 2 - centerX * k,
    y: viewport.height / 2 - centerY * k,
    k,
  };
}
