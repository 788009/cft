import provinceNames from '@/assets/data/province-names.json';

export type RegionLabelLevel = 'province' | 'city' | 'district';

interface RegionFeature {
  properties?: Record<string, unknown>;
}

export interface RegionLabelIdentity {
  adcode: string;
  name: string;
}

export function getRegionLabelIdentity(
  feature: RegionFeature,
  level: RegionLabelLevel,
): RegionLabelIdentity | null {
  const properties = feature.properties;
  if (!properties) return null;

  if (level === 'province') {
    const adcode = String(properties.province_adcode ?? '');
    const name = (provinceNames as Record<string, string>)[adcode];
    return adcode && name ? { adcode, name } : null;
  }

  const rawAdcode = level === 'city'
    ? properties.city_adcode ?? properties.adcode
    : properties.adcode;
  const adcode = String(rawAdcode ?? '');
  const name = typeof properties.name === 'string' ? properties.name.trim() : '';
  return adcode && name ? { adcode, name } : null;
}
