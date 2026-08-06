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
    this.dimensions = this.constrainDimensions(dimensions);
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
    this.dimensions = this.constrainLinkedDimensions(
      linkImageDimensions('width', width, aspectRatio),
      aspectRatio,
    );
    return this.getSnapshot();
  }

  public setHeight(height: number): SaveImageStateSnapshot {
    const aspectRatio = this.dimensions.width / this.dimensions.height;
    this.dimensions = this.constrainLinkedDimensions(
      linkImageDimensions('height', height, aspectRatio),
      aspectRatio,
    );
    return this.getSnapshot();
  }

  public applyMapResize(
    initialMapRect: Rect,
    resizedMapRect: Rect,
    initialDimensions = this.dimensions,
  ): SaveImageStateSnapshot {
    this.dimensions = this.constrainDimensions(scaleImageDimensionsForMapResize(
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

  private constrainLinkedDimensions(
    dimensions: ImageDimensions,
    aspectRatio: number,
  ): ImageDimensions {
    const config = defaultConfig.export;
    const maximumWidth = Math.min(
      config.maxDimension,
      config.maxDimension * aspectRatio,
      Math.sqrt(config.maxTotalPixels * aspectRatio),
    );
    const minimumWidth = Math.max(config.minDimension, config.minDimension * aspectRatio);
    const width = Math.min(maximumWidth, Math.max(minimumWidth, dimensions.width));
    return linkImageDimensions('width', width, aspectRatio);
  }

  private constrainDimensions(dimensions: ImageDimensions): ImageDimensions {
    const config = defaultConfig.export;
    let width = Math.round(this.requirePositive(dimensions.width, 'width'));
    let height = Math.round(this.requirePositive(dimensions.height, 'height'));
    width = Math.min(config.maxDimension, Math.max(config.minDimension, width));
    height = Math.min(config.maxDimension, Math.max(config.minDimension, height));
    const pixels = width * height;
    if (pixels > config.maxTotalPixels) {
      const scale = Math.sqrt(config.maxTotalPixels / pixels);
      width = Math.max(config.minDimension, Math.floor(width * scale));
      height = Math.max(config.minDimension, Math.floor(height * scale));
    }
    return { width, height };
  }

  private requirePositive(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} 必须是大于 0 的有限数值`);
    }
    return value;
  }
}
