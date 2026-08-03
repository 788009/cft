import { defaultConfig } from '@/config';
import { parseAdcodeMap, parseCsv, processStudentData } from './parser';
import type { ProcessedData, ProvinceAdcodeMap, CityAdcodeMap } from '@/types';

async function fetchRequired(path: string): Promise<Response> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`数据资源加载失败: ${path} (${response.status})`);
  }
  return response;
}

export async function loadInitialData(): Promise<ProcessedData> {
  const basePath = defaultConfig.dataBasePath;
  const [csvRes, provRes, cityRes] = await Promise.all([
    fetchRequired(`${basePath}/data.csv`),
    fetchRequired(`${basePath}/province2adcode.json`),
    fetchRequired(`${basePath}/cities2adcode.json`),
  ]);

  const csvText = await csvRes.text();
  const provMap = parseAdcodeMap(await provRes.json(), 'province2adcode.json') as ProvinceAdcodeMap;
  const cityMap = parseAdcodeMap(await cityRes.json(), 'cities2adcode.json') as CityAdcodeMap;

  const raw = parseCsv(csvText);
  return processStudentData(raw, provMap, cityMap);
}

export async function loadGeoJSON(filename: string): Promise<any> {
  const res = await fetchRequired(`${defaultConfig.dataBasePath}/geojson/${filename}`);
  return res.json();
}
