import type { Rect } from '@/logic/layout';

export type SaveImageMenuPlacement = 'right' | 'bottom';
export type SaveImageMapResizeHandle = 'east' | 'south' | 'south-east';

export interface SaveImageModeLayout {
  mapRect: Rect;
  menuRect: Rect;
  blankRects: Rect[];
  menuPlacement: SaveImageMenuPlacement;
}

export interface SaveImageLayoutOptions {
  viewportWidth: number;
  viewportHeight: number;
  mapAspectRatio: number;
  menuReservedRatio: number;
}

export interface SaveImageMapResizeOptions {
  initialMapRect: Rect;
  handle: SaveImageMapResizeHandle;
  deltaX: number;
  deltaY: number;
  viewportWidth: number;
  viewportHeight: number;
  minWidth: number;
  minHeight: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export function calculateInitialSaveImageLayout(
  options: SaveImageLayoutOptions,
): SaveImageModeLayout {
  const viewportWidth = positive(options.viewportWidth, 'viewportWidth');
  const viewportHeight = positive(options.viewportHeight, 'viewportHeight');
  const mapAspectRatio = positive(options.mapAspectRatio, 'mapAspectRatio');
  const menuReservedRatio = ratio(options.menuReservedRatio, 'menuReservedRatio');

  const rightMaximumWidth = viewportWidth * (1 - menuReservedRatio);
  const rightWidth = Math.min(rightMaximumWidth, viewportHeight * mapAspectRatio);
  const rightMapRect = rectFromSize(rightWidth, rightWidth / mapAspectRatio);

  const bottomMaximumHeight = viewportHeight * (1 - menuReservedRatio);
  const bottomHeight = Math.min(bottomMaximumHeight, viewportWidth / mapAspectRatio);
  const bottomMapRect = rectFromSize(bottomHeight * mapAspectRatio, bottomHeight);

  const rightArea = rightMapRect.width * rightMapRect.height;
  const bottomArea = bottomMapRect.width * bottomMapRect.height;
  const equalArea = nearlyEqual(rightArea, bottomArea);
  const menuPlacement: SaveImageMenuPlacement = rightArea > bottomArea || equalArea
    ? 'right'
    : 'bottom';
  return createSaveImageModeLayout(
    viewportWidth,
    viewportHeight,
    menuPlacement === 'right' ? rightMapRect : bottomMapRect,
    menuPlacement,
  );
}

export function createSaveImageModeLayout(
  viewportWidth: number,
  viewportHeight: number,
  mapRect: Rect,
  menuPlacement: SaveImageMenuPlacement,
): SaveImageModeLayout {
  const safeViewportWidth = positive(viewportWidth, 'viewportWidth');
  const safeViewportHeight = positive(viewportHeight, 'viewportHeight');
  const normalizedMapRect: Rect = {
    x: 0,
    y: 0,
    width: snapNearInteger(clamp(mapRect.width, 0, safeViewportWidth)),
    height: snapNearInteger(clamp(mapRect.height, 0, safeViewportHeight)),
  };
  const rightWidth = snapNearInteger(safeViewportWidth - normalizedMapRect.width);
  const bottomHeight = snapNearInteger(safeViewportHeight - normalizedMapRect.height);

  if (menuPlacement === 'right') {
    return {
      mapRect: normalizedMapRect,
      menuPlacement,
      menuRect: {
        x: normalizedMapRect.width,
        y: 0,
        width: rightWidth,
        height: safeViewportHeight,
      },
      blankRects: bottomHeight > 0
        ? [{ x: 0, y: normalizedMapRect.height, width: normalizedMapRect.width, height: bottomHeight }]
        : [],
    };
  }

  return {
    mapRect: normalizedMapRect,
    menuPlacement,
    menuRect: {
      x: 0,
      y: normalizedMapRect.height,
      width: safeViewportWidth,
      height: bottomHeight,
    },
    blankRects: rightWidth > 0
      ? [{ x: normalizedMapRect.width, y: 0, width: rightWidth, height: normalizedMapRect.height }]
      : [],
  };
}

export function resizeSaveImageMapRect(options: SaveImageMapResizeOptions): Rect {
  const maximumWidth = positive(options.viewportWidth, 'viewportWidth');
  const maximumHeight = positive(options.viewportHeight, 'viewportHeight');
  const minimumWidth = Math.min(positive(options.minWidth, 'minWidth'), maximumWidth);
  const minimumHeight = Math.min(positive(options.minHeight, 'minHeight'), maximumHeight);
  const changesWidth = options.handle === 'east' || options.handle === 'south-east';
  const changesHeight = options.handle === 'south' || options.handle === 'south-east';

  return {
    x: 0,
    y: 0,
    width: changesWidth
      ? clamp(options.initialMapRect.width + options.deltaX, minimumWidth, maximumWidth)
      : clamp(options.initialMapRect.width, minimumWidth, maximumWidth),
    height: changesHeight
      ? clamp(options.initialMapRect.height + options.deltaY, minimumHeight, maximumHeight)
      : clamp(options.initialMapRect.height, minimumHeight, maximumHeight),
  };
}

export function linkImageDimensions(
  changedDimension: 'width' | 'height',
  value: number,
  aspectRatio: number,
): ImageDimensions {
  const safeValue = positive(value, changedDimension);
  const safeAspectRatio = positive(aspectRatio, 'aspectRatio');
  return changedDimension === 'width'
    ? { width: Math.round(safeValue), height: Math.round(safeValue / safeAspectRatio) }
    : { width: Math.round(safeValue * safeAspectRatio), height: Math.round(safeValue) };
}

export function scaleImageDimensionsForMapResize(
  dimensions: ImageDimensions,
  initialMapRect: Rect,
  resizedMapRect: Rect,
): ImageDimensions {
  const initialWidth = positive(initialMapRect.width, 'initialMapRect.width');
  const initialHeight = positive(initialMapRect.height, 'initialMapRect.height');
  return {
    width: Math.max(1, Math.round(dimensions.width * resizedMapRect.width / initialWidth)),
    height: Math.max(1, Math.round(dimensions.height * resizedMapRect.height / initialHeight)),
  };
}

export function calculateAreaFontScale(
  dimensions: ImageDimensions,
  referenceDimensions: ImageDimensions,
  multiplier = 1,
): number {
  const area = positive(dimensions.width, 'dimensions.width') *
    positive(dimensions.height, 'dimensions.height');
  const referenceArea = positive(referenceDimensions.width, 'referenceDimensions.width') *
    positive(referenceDimensions.height, 'referenceDimensions.height');
  return Math.sqrt(area / referenceArea) * positive(multiplier, 'multiplier');
}

function rectFromSize(width: number, height: number): Rect {
  return { x: 0, y: 0, width, height };
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必须是大于 0 的有限数值`);
  }
  return value;
}

function ratio(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError(`${name} 必须是 0 到 1 之间的有限数值`);
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function nearlyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-12;
}

function snapNearInteger(value: number): number {
  const integer = Math.round(value);
  return Math.abs(value - integer) <= 1e-9 ? integer : value;
}
