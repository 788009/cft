import provinceNames from '@/assets/data/province-names.json';
import { geoContains } from 'd3';
import type { SchoolGroup } from '@/types';

export type RegionLabelLevel = 'province' | 'city' | 'district';

interface RegionFeature {
  properties?: Record<string, unknown>;
}

export interface RegionLabelIdentity {
  adcode: string;
  name: string;
}

export function getRegionFeatureLabelLevel(
  feature: RegionFeature,
  requestedLevel: RegionLabelLevel,
): RegionLabelLevel {
  if (requestedLevel === 'province') return 'province';
  const properties = feature.properties;
  if (
    requestedLevel === 'city' &&
    String(properties?.city_adcode ?? '') === String(properties?.province_adcode ?? '')
  ) return 'city';
  const featureLevel = feature.properties?.level;
  return featureLevel === 'city' || featureLevel === 'district'
    ? featureLevel
    : requestedLevel;
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
  const isMunicipality = level === 'city'
    && adcode === String(properties.province_adcode ?? '');
  const name = isMunicipality
    ? (provinceNames as Record<string, string>)[adcode]
    : typeof properties.name === 'string' ? properties.name.trim() : '';
  return adcode && name ? { adcode, name } : null;
}

export function getRegionAdcodesWithSchools(
  features: RegionFeature[],
  level: RegionLabelLevel,
  schools: SchoolGroup[],
): Set<string> {
  if (level === 'province') {
    return new Set(schools.flatMap((school) => school.provinceAdcode ?? []));
  }
  if (level === 'city') {
    return new Set(schools.flatMap((school) => school.cityAdcode ?? []));
  }

  const schoolCoordinates = schools.flatMap((school): [number, number][] => (
    school.lng === null || school.lat === null ? [] : [[school.lng, school.lat]]
  ));
  const adcodes = new Set<string>();
  for (const feature of features) {
    const identity = getRegionLabelIdentity(feature, level);
    if (
      identity &&
      schoolCoordinates.some((coordinates) => geoContains(feature as never, coordinates))
    ) adcodes.add(identity.adcode);
  }
  return adcodes;
}
