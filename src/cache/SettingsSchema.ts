import type { AppSettingsState } from '@/settings/SettingsState';
import type { InfoRectanglePlacement } from '@/map/InfoRectangle';

export const SETTINGS_SCHEMA_VERSION = 1;

export type CachedSettingsValues = Omit<AppSettingsState, 'backgroundFile'>;

export interface CachedSettingsEnvelope {
  schemaVersion: number;
  savedAt: number;
  values: CachedSettingsValues;
}

export function createSettingsEnvelope(
  state: Readonly<AppSettingsState>,
  savedAt = Date.now(),
): CachedSettingsEnvelope {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    savedAt,
    values: {
      interactionMode: state.interactionMode,
      themeMode: state.themeMode,
      cardGroupingMode: state.cardGroupingMode,
      showRegionNames: state.showRegionNames,
      onlyShowRegionNamesWithSchools: state.onlyShowRegionNamesWithSchools,
      showInfoRectangle: state.showInfoRectangle,
      showMiddleSchool: state.showMiddleSchool,
      enableLocalLayoutOptimization: state.enableLocalLayoutOptimization,
      infoRectanglePlacement: { ...state.infoRectanglePlacement },
    },
  };
}

export function migrateCachedSettings(
  input: unknown,
  defaults: Readonly<AppSettingsState>,
): CachedSettingsEnvelope | null {
  if (!isRecord(input)) return null;
  const schemaVersion = input.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) return null;
  if (schemaVersion < 1 || schemaVersion > SETTINGS_SCHEMA_VERSION) return null;

  let migrated: Record<string, unknown> = input;
  let version = schemaVersion;
  while (version < SETTINGS_SCHEMA_VERSION) {
    migrated = migrateOneVersion(version, migrated);
    version += 1;
  }

  if (!isRecord(migrated.values)) return null;
  const values = migrated.values;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    savedAt: isFiniteNumber(migrated.savedAt) ? migrated.savedAt : Date.now(),
    values: {
      interactionMode: isOneOf(
        values.interactionMode,
        ['stable', 'hide-and-reflow'] as const,
      )
        ? values.interactionMode
        : defaults.interactionMode,
      themeMode: isOneOf(values.themeMode, ['system', 'light', 'dark'] as const)
        ? values.themeMode
        : defaults.themeMode,
      cardGroupingMode: isOneOf(values.cardGroupingMode, ['school', 'region'] as const)
        ? values.cardGroupingMode
        : defaults.cardGroupingMode,
      showRegionNames: booleanOrDefault(values.showRegionNames, defaults.showRegionNames),
      onlyShowRegionNamesWithSchools: booleanOrDefault(
        values.onlyShowRegionNamesWithSchools,
        defaults.onlyShowRegionNamesWithSchools,
      ),
      showInfoRectangle: booleanOrDefault(
        values.showInfoRectangle,
        defaults.showInfoRectangle,
      ),
      showMiddleSchool: booleanOrDefault(values.showMiddleSchool, defaults.showMiddleSchool),
      enableLocalLayoutOptimization: booleanOrDefault(
        values.enableLocalLayoutOptimization,
        defaults.enableLocalLayoutOptimization,
      ),
      infoRectanglePlacement: parseInfoRectanglePlacement(
        values.infoRectanglePlacement,
        defaults.infoRectanglePlacement,
      ),
    },
  };
}

function migrateOneVersion(
  version: number,
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  switch (version) {
    default:
      return envelope;
  }
}

function parseInfoRectanglePlacement(
  value: unknown,
  fallback: InfoRectanglePlacement,
): InfoRectanglePlacement {
  if (!isRecord(value)) return { ...fallback };
  const { xRatio, yRatio, widthRatio, heightRatio } = value;
  if (
    !isFiniteNumber(xRatio) ||
    !isFiniteNumber(yRatio) ||
    !isFiniteNumber(widthRatio) ||
    !isFiniteNumber(heightRatio)
  ) return { ...fallback };
  if (
    xRatio < 0 ||
    yRatio < 0 ||
    widthRatio <= 0 ||
    heightRatio <= 0 ||
    xRatio + widthRatio > 1 ||
    yRatio + heightRatio > 1
  ) {
    return { ...fallback };
  }
  return { xRatio, yRatio, widthRatio, heightRatio };
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}
