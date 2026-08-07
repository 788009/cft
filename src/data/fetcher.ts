import { defaultConfig } from '@/config';
import {
  parseAdcodeMap,
  parseCsv,
  parseMiddleSchoolInfo,
  parseTeachers,
  processStudentData,
} from './parser';
import type { ProcessedData, ProvinceAdcodeMap, CityAdcodeMap } from '@/types';
import { fetchAppResource } from '@/cache/ResourceCache';

async function fetchRequired(path: string): Promise<Response> {
  const response = await fetchAppResource(path);
  if (!response.ok) {
    throw new Error(`数据资源加载失败: ${path} (${response.status})`);
  }
  return response;
}

export function getDataAssetUrl(relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${defaultConfig.dataBasePath}/${encodedPath}`;
}

export async function loadMessageHtml(): Promise<string> {
  const response = await fetchRequired(getDataAssetUrl('message.html'));
  return response.text();
}

export async function loadInitialData(): Promise<ProcessedData> {
  const basePath = defaultConfig.dataBasePath;
  const [csvRes, provRes, cityRes, middleSchoolRes, teachersRes] = await Promise.all([
    fetchRequired(`${basePath}/data.csv`),
    fetchRequired(`${basePath}/province2adcode.json`),
    fetchRequired(`${basePath}/cities2adcode.json`),
    fetchRequired(`${basePath}/middle_school_info.json`),
    fetchRequired(`${basePath}/teachers.json`),
  ]);

  const csvText = await csvRes.text();
  const provMap = parseAdcodeMap(await provRes.json(), 'province2adcode.json') as ProvinceAdcodeMap;
  const cityMap = parseAdcodeMap(await cityRes.json(), 'cities2adcode.json') as CityAdcodeMap;
  const middleSchool = parseMiddleSchoolInfo(
    await middleSchoolRes.json(),
    'middle_school_info.json',
  );
  const teachers = parseTeachers(await teachersRes.json(), 'teachers.json');

  const raw = parseCsv(csvText);
  return processStudentData(raw, provMap, cityMap, middleSchool, teachers);
}

export async function loadGeoJSON(filename: string): Promise<any> {
  const res = await fetchRequired(`${defaultConfig.dataBasePath}/geojson/${filename}`);
  return res.json();
}
