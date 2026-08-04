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

export interface RegionSchoolPlacement {
  school: SchoolGroup;
  column: number;
  row: number;
}

export interface RegionSchoolGrid {
  columns: 1 | 2;
  studentsPerRow: number;
  contentRows: number;
  placements: RegionSchoolPlacement[];
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

export function getRegionSchoolGrid(
  schools: SchoolGroup[],
  studentsPerRow: number,
): RegionSchoolGrid {
  const columns = schools.length >= 4 ? 2 : 1;
  const placements: RegionSchoolPlacement[] = [];
  let nextRow = 2;
  for (let index = 0; index < schools.length; index += columns) {
    const schoolsInRow = schools.slice(index, index + columns);
    for (const [column, school] of schoolsInRow.entries()) {
      placements.push({ school, column, row: nextRow });
    }
    nextRow += Math.max(...schoolsInRow.map((school) => (
      1 + Math.ceil(school.students.length / studentsPerRow)
    )));
  }
  return {
    columns,
    studentsPerRow,
    contentRows: nextRow - 1,
    placements,
  };
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
