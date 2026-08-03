import { defaultConfig } from '@/config';
import { parseCsv, processStudentData } from './parser';
import type { ProcessedData, ProvinceAdcodeMap, CityAdcodeMap } from '@/types';

export async function loadInitialData(): Promise<ProcessedData> {
  const basePath = defaultConfig.dataBasePath;
  const [csvRes, provRes, cityRes] = await Promise.all([
    fetch(`${basePath}/data.csv`),
    fetch(`${basePath}/province2adcode.json`),
    fetch(`${basePath}/cities2adcode.json`)
  ]);

  if (!csvRes.ok || !provRes.ok || !cityRes.ok) {
    throw new Error('基础数据加载失败');
  }

  const csvText = await csvRes.text();
  const provMap = (await provRes.json()) as ProvinceAdcodeMap;
  const cityMap = (await cityRes.json()) as CityAdcodeMap;

  const raw = parseCsv(csvText);
  return processStudentData(raw, provMap, cityMap);
}

export async function loadGeoJSON(filename: string): Promise<any> {
  const res = await fetch(`${defaultConfig.dataBasePath}/geojson/${filename}`);
  if (!res.ok) {
    throw new Error(`GeoJSON 文件加载失败: ${filename}`);
  }
  return res.json();
}
