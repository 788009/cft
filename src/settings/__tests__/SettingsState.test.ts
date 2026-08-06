import { describe, expect, it, vi } from 'vitest';
import { SettingsStateStore, type AppSettingsState } from '../SettingsState';

function createState(): AppSettingsState {
  return {
    interactionMode: 'stable',
    themeMode: 'system',
    backgroundFile: null,
    cardGroupingMode: 'region',
    showRegionNames: true,
    onlyShowRegionNamesWithSchools: true,
    showInfoRectangle: false,
    showMiddleSchool: true,
    enableLocalLayoutOptimization: false,
  };
}

describe('settings state store', () => {
  it('shares updates and ignores unchanged patches', () => {
    const store = new SettingsStateStore(createState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({ themeMode: 'system' });
    expect(listener).not.toHaveBeenCalled();

    store.update({ themeMode: 'dark', cardGroupingMode: 'school' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      themeMode: 'dark',
      cardGroupingMode: 'school',
    });
  });

  it('returns snapshots that cannot mutate stored settings', () => {
    const store = new SettingsStateStore(createState());
    const snapshot = store.getSnapshot() as AppSettingsState;
    snapshot.showMiddleSchool = false;
    expect(store.getSnapshot().showMiddleSchool).toBe(true);
  });
});
