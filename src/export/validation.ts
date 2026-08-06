import { defaultConfig } from '@/config';

export function validateExportDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new RangeError('图片宽度和高度必须是整数');
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError('图片宽度和高度必须大于 0');
  }
}

export function getExportDimensionWarnings(width: number, height: number): string[] {
  const config = defaultConfig.export;
  const warnings: string[] = [];
  if (width < config.minDimension || height < config.minDimension) {
    warnings.push('图片尺寸较小，文字和地图细节可能不清晰');
  }
  if (width > config.maxDimension || height > config.maxDimension) {
    warnings.push('图片单边尺寸较大，浏览器可能无法创建画布');
  }
  if (width * height > config.maxTotalPixels) {
    warnings.push('图片总像素数较大，生成时可能占用较多内存');
  }
  return warnings;
}
