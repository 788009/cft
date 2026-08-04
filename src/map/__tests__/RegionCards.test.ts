import { describe, expect, it } from 'vitest';
import {
  createRegionCardGroups,
  getRegionGroupingLevel,
  getRegionSchoolGrid,
  parseGeoJsonCenter,
} from '../RegionCards';
import type { SchoolGroup } from '@/types';

const school = (university: string, provinceAdcode: string, cityAdcode: string): SchoolGroup => ({
  university,
  province: '测试省',
  city: '测试市',
  provinceAdcode,
  cityAdcode,
  lat: 30,
  lng: 110,
  isForeign: false,
  students: [],
});

describe('region cards', () => {
  it('parses the GeoJSON center string as longitude and latitude', () => {
    expect(parseGeoJsonCenter('[108.380246  30.807807]')).toEqual([108.380246, 30.807807]);
    expect(parseGeoJsonCenter([108, 30])).toBeNull();
    expect(parseGeoJsonCenter('invalid')).toBeNull();
  });

  it('uses provinces at province level and cities at both detailed levels', () => {
    expect(getRegionGroupingLevel('province')).toBe('province');
    expect(getRegionGroupingLevel('city')).toBe('city');
    expect(getRegionGroupingLevel('district')).toBe('city');
  });

  it('combines schools in the same region and uses its supplied center', () => {
    const schools = [school('大学甲', '610000', '610100'), school('大学乙', '610000', '610100')];
    const centers = new Map([['610100', {
      adcode: '610100', name: '西安市', longitude: 108.94, latitude: 34.34,
    }]]);
    expect(createRegionCardGroups(schools, 'district', centers)).toEqual([{
      id: 'region:city:610100', level: 'city', schools,
      adcode: '610100', name: '西安市', longitude: 108.94, latitude: 34.34,
    }]);
  });

  it('uses two university columns only when a region contains at least four schools', () => {
    const three = ['甲', '乙', '丙'].map((name) => school(name, '610000', '610100'));
    const four = [...three, school('丁', '610000', '610100')];
    expect(getRegionSchoolGrid(three, 2).columns).toBe(1);
    expect(getRegionSchoolGrid(four, 2)).toMatchObject({
      columns: 2,
      placements: [
        { school: four[0], column: 0, row: 2 },
        { school: four[1], column: 1, row: 2 },
        { school: four[2], column: 0, row: 3 },
        { school: four[3], column: 1, row: 3 },
      ],
    });
  });
});
