import { describe, expect, it } from 'vitest';
import { getRegionLabelIdentity } from '@/map/RegionLabels';

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
});
