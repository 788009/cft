import { defaultConfig } from '@/config';

export function validateExportDimensions(width: number, height: number): void {
  const config = defaultConfig.export;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new RangeError('图片宽度和高度必须是整数');
  }
  if (
    width < config.minDimension || width > config.maxDimension ||
    height < config.minDimension || height > config.maxDimension
  ) {
    throw new RangeError(
      `图片单边尺寸必须在 ${config.minDimension} 至 ${config.maxDimension} 像素之间`,
    );
  }
  if (width * height > config.maxTotalPixels) {
    throw new RangeError(`图片总像素数不能超过 ${config.maxTotalPixels}`);
  }
}
