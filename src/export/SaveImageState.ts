import { defaultConfig } from '@/config';
import {
  calculateAreaFontScale,
  linkImageDimensions,
  scaleImageDimensionsForMapResize,
  type ImageDimensions,
} from './geometry';
import type { Rect } from '@/logic/layout';

export interface SaveImageAddedImage {
  id: string;
  url: string;
  title: string;
  rect: Rect;
}

export interface SaveImageStateSnapshot extends ImageDimensions {
  aspectRatio: number;
  fontScaleMultiplier: number;
  fontScale: number;
  addedImages: SaveImageAddedImage[];
}

export class SaveImageState {
  private dimensions: ImageDimensions;
  private fontScaleMultiplier: number;
  private addedImages: SaveImageAddedImage[] = [];

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
      addedImages: [...this.addedImages],
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
    const scaleX = resizedMapRect.width / initialMapRect.width;
    const scaleY = resizedMapRect.height / initialMapRect.height;
    this.addedImages = this.addedImages.map((img) => ({
      ...img,
      rect: {
        x: img.rect.x * scaleX,
        y: img.rect.y * scaleY,
        width: img.rect.width * scaleX,
        height: img.rect.height * scaleY,
      },
    }));
    return this.getSnapshot();
  }

  public setFontScaleMultiplier(multiplier: number): SaveImageStateSnapshot {
    this.fontScaleMultiplier = this.requirePositive(multiplier, 'fontScaleMultiplier');
    return this.getSnapshot();
  }

  public addImage(image: Omit<SaveImageAddedImage, 'id'>): SaveImageStateSnapshot {
    this.addedImages.push({ ...image, id: Math.random().toString(36).slice(2) });
    return this.getSnapshot();
  }

  public removeImage(id: string): SaveImageStateSnapshot {
    this.addedImages = this.addedImages.filter((img) => img.id !== id);
    return this.getSnapshot();
  }

  public updateImageRect(id: string, rect: Rect): SaveImageStateSnapshot {
    const index = this.addedImages.findIndex((img) => img.id === id);
    if (index !== -1) {
      this.addedImages[index] = { ...this.addedImages[index], rect };
    }
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
