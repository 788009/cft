import type { Corner } from '@/config';
import type { Rect } from '@/logic/layout';

export interface SearchControlPlacementOptions {
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  corner: Corner;
  margin: number;
  gap: number;
  occupiedRects: Rect[];
}

export function getSearchControlPlacement(options: SearchControlPlacementOptions): Rect {
  const {
    viewportWidth,
    viewportHeight,
    width,
    height,
    corner,
    margin,
    gap,
    occupiedRects,
  } = options;
  const isLeft = corner.endsWith('left');
  const isTop = corner.startsWith('top');
  const edgeX = isLeft ? margin : viewportWidth - margin - width;
  const occupiedX = occupiedRects.map((rect) => (
    isLeft ? rect.x + rect.width + gap : rect.x - gap - width
  ));
  const x = occupiedX.length === 0
    ? edgeX
    : isLeft ? Math.max(edgeX, ...occupiedX) : Math.min(edgeX, ...occupiedX);
  const y = isTop ? margin : viewportHeight - margin - height;

  return {
    x: Math.max(margin, Math.min(viewportWidth - margin - width, x)),
    y: Math.max(margin, Math.min(viewportHeight - margin - height, y)),
    width,
    height,
  };
}
