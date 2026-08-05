import { describe, expect, it } from 'vitest';
import {
  getRegionAdcodesWithSchools,
  getRegionFeatureLabelLevel,
  getRegionLabelIdentity,
} from '@/map/RegionLabels';
import type { SchoolGroup } from '@/types';

describe('region label identities', () => {
  it('uses the local province mapping instead of misleading province feature names', () => {
    expect(getRegionLabelIdentity({
      properties: {
        province_adcode: '610000',
        adcode: 610100,
        name: '西安市',
      },
    }, 'province')).toEqual({ adcode: '610000', name: '陕西省' });
  });

  it('reads city and district names from their GeoJSON properties', () => {
    expect(getRegionLabelIdentity({
      properties: { city_adcode: '610100', name: '西安市' },
    }, 'city')).toEqual({ adcode: '610100', name: '西安市' });
    expect(getRegionLabelIdentity({
      properties: { adcode: 610102, name: '新城区' },
    }, 'district')).toEqual({ adcode: '610102', name: '新城区' });
  });

  it('uses the municipality name at city level and the district name at district level', () => {
    const municipalityDistrict = {
      properties: {
        level: 'district',
        province_adcode: '110000',
        city_adcode: '110000',
        adcode: 110101,
        name: '东城区',
      },
    };

    expect(getRegionFeatureLabelLevel(municipalityDistrict, 'city')).toBe('city');
    expect(getRegionLabelIdentity(municipalityDistrict, 'city'))
      .toEqual({ adcode: '110000', name: '北京市' });
    expect(getRegionFeatureLabelLevel(municipalityDistrict, 'district')).toBe('district');
    expect(getRegionLabelIdentity(municipalityDistrict, 'district'))
      .toEqual({ adcode: '110101', name: '东城区' });
  });

  it('finds the district geometry containing a university coordinate', () => {
    const feature = {
      type: 'Feature',
      properties: { adcode: 610102, name: '新城区' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[108, 34], [108, 35], [110, 35], [110, 34], [108, 34]]],
      },
    };
    const school = {
      university: '测试大学',
      province: '测试省',
      city: '测试市',
      provinceAdcode: '610000',
      cityAdcode: '610100',
      lat: 34.5,
      lng: 109,
      isForeign: false,
      students: [],
    } satisfies SchoolGroup;
    expect(getRegionAdcodesWithSchools([feature], 'district', [school]))
      .toEqual(new Set(['610102']));
  });
});
