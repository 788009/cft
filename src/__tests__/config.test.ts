import { describe, expect, it } from 'vitest';
import { defaultConfig, resolveDataBasePath } from '@/config';

describe('App config', () => {
  it('resolves the data directory from root and nested Vite base paths', () => {
    expect(resolveDataBasePath('/')).toBe('/data');
    expect(resolveDataBasePath('/cft/')).toBe('/cft/data');
  });

  it('keeps adaptive label scaling in the centralized config', () => {
    expect(defaultConfig.labelScale).toEqual({ min: 0.5, step: 0.1 });
    expect(defaultConfig.infoRectangleEditor).toEqual({
      minWidth: 120,
      minHeight: 80,
      handleSize: 12,
      handleHitSize: 44,
    });
    expect(defaultConfig.initialSchoolExtentRatio).toBe(0.8);
    expect(defaultConfig.mapZoomExtent).toEqual({ min: 1, max: 20 });
  });

  it('keeps settings placement and the default interaction mode configurable', () => {
    expect(defaultConfig.settingsButtonCorner).toBe('top-left');
    expect(defaultConfig.cardGroupingMode).toBe('school');
    expect(defaultConfig.labelStyle.regionFontSize).toBeGreaterThan(
      defaultConfig.labelStyle.universityFontSize,
    );
    expect(defaultConfig.layoutWeights.lineOcclusion).toBeGreaterThan(
      defaultConfig.layoutWeights.lineIntersection,
    );
    expect(defaultConfig.layoutWeights.infoEdgeDistance).toBeGreaterThan(0);
    expect(defaultConfig.mapInteractionMode).toBe('hide-and-reflow');
    expect(defaultConfig.themeMode).toBe('system');
    expect(defaultConfig.showRegionNames).toBe(true);
    expect(defaultConfig.onlyShowRegionNamesWithSchools).toBe(true);
    expect(defaultConfig.showInfoRectangle).toBe(true);
    expect(defaultConfig.enableLocalLayoutOptimization).toBe(false);
  });
});
