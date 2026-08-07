import { describe, expect, it } from 'vitest';
import type { AppSettingsState } from '@/settings/SettingsState';
import {
  SETTINGS_SCHEMA_VERSION,
  createSettingsEnvelope,
  migrateCachedSettings,
} from '../SettingsSchema';

function defaults(): AppSettingsState {
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
    infoRectanglePlacement: {
      xRatio: 0.25,
      yRatio: 0.25,
      widthRatio: 0.5,
      heightRatio: 0.5,
    },
  };
}

describe('cached settings schema', () => {
  it('stores only whitelisted settings and excludes uploaded files', () => {
    const state = defaults();
    state.backgroundFile = { name: 'background.png', type: 'image/png' } as File;
    const envelope = createSettingsEnvelope(state, 100);

    expect(envelope.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(envelope.savedAt).toBe(100);
    expect(envelope.values).not.toHaveProperty('backgroundFile');
  });

  it('uses current defaults for missing or invalid fields', () => {
    const result = migrateCachedSettings({
      schemaVersion: 1,
      savedAt: 10,
      values: {
        themeMode: 'dark',
        interactionMode: 'invalid',
        showRegionNames: false,
        infoRectanglePlacement: {
          xRatio: -1,
          yRatio: 0,
          widthRatio: 1,
          heightRatio: 1,
        },
      },
    }, defaults());

    expect(result?.values).toMatchObject({
      themeMode: 'dark',
      interactionMode: 'stable',
      showRegionNames: false,
      showMiddleSchool: true,
      infoRectanglePlacement: defaults().infoRectanglePlacement,
    });
  });

  it('rejects unknown schema versions', () => {
    expect(migrateCachedSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION + 1,
      values: {},
    }, defaults())).toBeNull();
  });
});
