import { defaultConfig } from '@/config';
import type { Rect } from '@/logic/layout';

export interface InfoRectanglePlacement {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export type InfoRectangleResizeHandle =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';

export function getDefaultInfoRectanglePlacement(): InfoRectanglePlacement {
  const widthRatio = defaultConfig.infoRectangleWidthRatio;
  const heightRatio = defaultConfig.infoRectangleHeightRatio;
  return {
    xRatio: (1 - widthRatio) / 2,
    yRatio: (1 - heightRatio) / 2,
    widthRatio,
    heightRatio,
  };
}

export function getInfoRectangle(
  width: number,
  height: number,
  placement = getDefaultInfoRectanglePlacement(),
): Rect {
  return {
    x: width * placement.xRatio,
    y: height * placement.yRatio,
    width: width * placement.widthRatio,
    height: height * placement.heightRatio,
  };
}

export function getInfoRectanglePlacement(
  rect: Rect,
  width: number,
  height: number,
): InfoRectanglePlacement {
  return {
    xRatio: width > 0 ? rect.x / width : 0,
    yRatio: height > 0 ? rect.y / height : 0,
    widthRatio: width > 0 ? rect.width / width : 0,
    heightRatio: height > 0 ? rect.height / height : 0,
  };
}

export function expandRectWithinBounds(rect: Rect, padding: number, bounds: Rect): Rect {
  const safePadding = Math.max(0, padding);
  const left = Math.max(bounds.x, rect.x - safePadding);
  const top = Math.max(bounds.y, rect.y - safePadding);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width + safePadding);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height + safePadding);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function moveInfoRectangle(
  initial: Rect,
  deltaX: number,
  deltaY: number,
  bounds: Rect,
): Rect {
  return {
    ...initial,
    x: clamp(initial.x + deltaX, bounds.x, bounds.x + bounds.width - initial.width),
    y: clamp(initial.y + deltaY, bounds.y, bounds.y + bounds.height - initial.height),
  };
}

export function resizeInfoRectangle(
  initial: Rect,
  handle: InfoRectangleResizeHandle,
  deltaX: number,
  deltaY: number,
  bounds: Rect,
  minWidth: number,
  minHeight: number,
): Rect {
  let left = initial.x;
  let right = initial.x + initial.width;
  let top = initial.y;
  let bottom = initial.y + initial.height;

  if (handle.includes('w')) left = clamp(left + deltaX, bounds.x, right - minWidth);
  if (handle.includes('e')) right = clamp(right + deltaX, left + minWidth, bounds.x + bounds.width);
  if (handle.includes('n')) top = clamp(top + deltaY, bounds.y, bottom - minHeight);
  if (handle.includes('s')) bottom = clamp(bottom + deltaY, top + minHeight, bounds.y + bounds.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
