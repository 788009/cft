import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../ThemeController';

describe('ThemeController', () => {
  it('resolves explicit and system theme modes', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
  });
});
