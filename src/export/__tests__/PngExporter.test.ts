import { describe, expect, it } from 'vitest';
import {
  getExportDimensionWarnings,
  validateExportDimensions,
} from '../validation';

describe('PNG exporter', () => {
  it('accepts positive integer dimensions regardless of configured warning thresholds', () => {
    expect(() => validateExportDimensions(2880, 1800)).not.toThrow();
    expect(() => validateExportDimensions(20000, 12000)).not.toThrow();
    expect(() => validateExportDimensions(1, 1)).not.toThrow();
  });

  it('rejects non-positive dimensions', () => {
    expect(() => validateExportDimensions(0, 1800)).toThrow(/大于 0/);
    expect(() => validateExportDimensions(2880, -1)).toThrow(/大于 0/);
  });

  it('rejects fractional dimensions', () => {
    expect(() => validateExportDimensions(2880.5, 1800)).toThrow(/整数/);
  });

  it('reports distinct quality, canvas and memory warnings', () => {
    expect(getExportDimensionWarnings(500, 400)).toEqual([
      '图片尺寸较小，文字和地图细节可能不清晰',
    ]);
    expect(getExportDimensionWarnings(9000, 1000)).toEqual([
      '图片单边尺寸较大，浏览器可能无法创建画布',
    ]);
    expect(getExportDimensionWarnings(8000, 5000)).toEqual([
      '图片总像素数较大，生成时可能占用较多内存',
    ]);
  });
});
