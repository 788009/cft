import { describe, expect, it } from 'vitest';
import { resolveDataBasePath } from '@/config';

describe('App config', () => {
  it('resolves the data directory from root and nested Vite base paths', () => {
    expect(resolveDataBasePath('/')).toBe('/data');
    expect(resolveDataBasePath('/cft/')).toBe('/cft/data');
  });
});
