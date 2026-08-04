import type { MapLevel } from './LevelManager';
import type { SchoolGroup } from '@/types';

export interface RegionCenter {
  adcode: string;
  name: string;
  longitude: number;
  latitude: number;
}

export interface RegionCardGroup extends RegionCenter {
  id: string;
  level: 'province' | 'city';
  schools: SchoolGroup[];
}

export function parseGeoJsonCenter(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]$/);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
}

export function getRegionGroupingLevel(level: MapLevel): 'province' | 'city' {
  return level === 'province' ? 'province' : 'city';
}

export function createRegionCardGroups(
  schools: SchoolGroup[],
  level: MapLevel,
  centers: ReadonlyMap<string, RegionCenter>,
): RegionCardGroup[] {
  const groupingLevel = getRegionGroupingLevel(level);
  const grouped = new Map<string, SchoolGroup[]>();
  for (const school of schools) {
    const adcode = groupingLevel === 'province' ? school.provinceAdcode : school.cityAdcode;
    if (!adcode) continue;
    const regionSchools = grouped.get(adcode) ?? [];
    regionSchools.push(school);
    grouped.set(adcode, regionSchools);
  }

  return Array.from(grouped, ([adcode, regionSchools]) => {
    const center = centers.get(adcode);
    if (!center) return null;
    return {
      ...center,
      id: `region:${groupingLevel}:${adcode}`,
      level: groupingLevel,
      schools: regionSchools,
    } satisfies RegionCardGroup;
  }).filter((group): group is RegionCardGroup => group !== null);
}
