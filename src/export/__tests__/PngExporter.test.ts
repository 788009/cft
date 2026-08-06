import { describe, expect, it } from 'vitest';
import { validateExportDimensions } from '../validation';

describe('PNG exporter', () => {
  it('accepts dimensions within the configured limits', () => {
    expect(() => validateExportDimensions(2880, 1800)).not.toThrow();
    expect(() => validateExportDimensions(8192, 3906)).not.toThrow();
  });

  it('rejects dimensions outside the side limits', () => {
    expect(() => validateExportDimensions(511, 1800)).toThrow(/单边尺寸/);
    expect(() => validateExportDimensions(2880, 8193)).toThrow(/单边尺寸/);
  });

  it('rejects dimensions above the total pixel limit', () => {
    expect(() => validateExportDimensions(8192, 3907)).toThrow(/总像素数/);
  });

  it('rejects fractional dimensions', () => {
    expect(() => validateExportDimensions(2880.5, 1800)).toThrow(/整数/);
  });
});
