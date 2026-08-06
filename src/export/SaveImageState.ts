import { defaultConfig } from '@/config';
import {
  calculateAreaFontScale,
  linkImageDimensions,
  scaleImageDimensionsForMapResize,
  type ImageDimensions,
} from './geometry';
import type { Rect } from '@/logic/layout';

export interface SaveImageStateSnapshot extends ImageDimensions {
  aspectRatio: number;
  fontScaleMultiplier: number;
  fontScale: number;
}

export class SaveImageState {
  private dimensions: ImageDimensions;
  private fontScaleMultiplier: number;

  constructor(
    dimensions: ImageDimensions = {
      width: defaultConfig.export.defaultWidth,
      height: defaultConfig.export.defaultHeight,
    },
    fontScaleMultiplier = defaultConfig.export.defaultFontScaleMultiplier,
  ) {
    this.dimensions = this.normalizeDimensions(dimensions);
    this.fontScaleMultiplier = this.requirePositive(fontScaleMultiplier, 'fontScaleMultiplier');
  }

  public getSnapshot(): SaveImageStateSnapshot {
    return {
      ...this.dimensions,
      aspectRatio: this.dimensions.width / this.dimensions.height,
      fontScaleMultiplier: this.fontScaleMultiplier,
      fontScale: calculateAreaFontScale(
        this.dimensions,
        defaultConfig.export.fontScaleAreaRootRatio,
        this.fontScaleMultiplier,
      ),
    };
  }

  public setWidth(width: number): SaveImageStateSnapshot {
    const aspectRatio = this.dimensions.width / this.dimensions.height;
    this.dimensions = linkImageDimensions('width', width, aspectRatio);
    return this.getSnapshot();
  }

  public setHeight(height: number): SaveImageStateSnapshot {
    const aspectRatio = this.dimensions.width / this.dimensions.height;
    this.dimensions = linkImageDimensions('height', height, aspectRatio);
    return this.getSnapshot();
  }

  public applyMapResize(
    initialMapRect: Rect,
    resizedMapRect: Rect,
    initialDimensions = this.dimensions,
  ): SaveImageStateSnapshot {
    this.dimensions = this.normalizeDimensions(scaleImageDimensionsForMapResize(
      initialDimensions,
      initialMapRect,
      resizedMapRect,
    ));
    return this.getSnapshot();
  }

  public setFontScaleMultiplier(multiplier: number): SaveImageStateSnapshot {
    this.fontScaleMultiplier = this.requirePositive(multiplier, 'fontScaleMultiplier');
    return this.getSnapshot();
  }

  private normalizeDimensions(dimensions: ImageDimensions): ImageDimensions {
    return {
      width: Math.max(1, Math.round(this.requirePositive(dimensions.width, 'width'))),
      height: Math.max(1, Math.round(this.requirePositive(dimensions.height, 'height'))),
    };
  }

  private requirePositive(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} 必须是大于 0 的有限数值`);
    }
    return value;
  }
}
