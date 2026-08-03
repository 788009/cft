import { describe, expect, it } from 'vitest';
import { defaultConfig, resolveDataBasePath } from '@/config';

describe('App config', () => {
  it('resolves the data directory from root and nested Vite base paths', () => {
    expect(resolveDataBasePath('/')).toBe('/data');
    expect(resolveDataBasePath('/cft/')).toBe('/cft/data');
  });

  it('keeps adaptive label scaling in the centralized config', () => {
    expect(defaultConfig.labelScale).toEqual({ min: 0.5, step: 0.1 });
  });

  it('keeps settings placement and the default interaction mode configurable', () => {
    expect(defaultConfig.settingsButtonCorner).toBe('top-left');
    expect(defaultConfig.mapInteractionMode).toBe('hide-and-reflow');
    expect(defaultConfig.themeMode).toBe('system');
    expect(defaultConfig.showRegionNames).toBe(true);
    expect(defaultConfig.onlyShowRegionNamesWithSchools).toBe(true);
  });
});
