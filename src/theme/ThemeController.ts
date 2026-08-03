import type { ThemeMode } from '@/config';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

export class ThemeController {
  private readonly mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private mode: ThemeMode;

  constructor(initialMode: ThemeMode) {
    this.mode = initialMode;
    this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);
    this.apply();
  }

  public setMode(mode: ThemeMode): void {
    this.mode = mode;
    this.apply();
  }

  public destroy(): void {
    this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange);
  }

  private readonly handleSystemThemeChange = (): void => {
    if (this.mode === 'system') this.apply();
  };

  private apply(): void {
    const resolved = resolveTheme(this.mode, this.mediaQuery.matches);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset.themeMode = this.mode;
    document.documentElement.dataset.resolvedTheme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }
}
