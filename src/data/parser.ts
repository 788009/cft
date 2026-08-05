import type {
    RawStudent,
    Student,
    SchoolGroup,
    ProvinceAdcodeMap,
    CityAdcodeMap,
    ProcessedData,
    MiddleSchoolInfo,
} from '@/types';
import { csvParseRows } from 'd3';

const REQUIRED_HEADERS: (keyof RawStudent)[] = [
  'no',
  'name',
  'short',
  'university',
  'province',
  'city',
  'contact',
  'lat',
  'lng',
];

const REQUIRED_VALUES: (keyof RawStudent)[] = [
  'no',
  'name',
  'short',
  'university',
  'province',
  'city',
];

export class DataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataValidationError';
  }
}

export function parseCsv(csvText: string): RawStudent[] {
  const rows = csvParseRows(csvText).filter((row) => row.some((value) => value.trim() !== ''));

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header, index) => {
    const trimmed = header.trim();
    return index === 0 ? trimmed.replace(/^\uFEFF/, '') : trimmed;
  });
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) {
    throw new DataValidationError(`CSV 表头重复: ${[...new Set(duplicateHeaders)].join(', ')}`);
  }

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new DataValidationError(`CSV 缺少必要表头: ${missingHeaders.join(', ')}`);
  }

  return rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new DataValidationError(
        `CSV 第 ${rowNumber} 行列数错误: 预期 ${headers.length} 列，实际 ${values.length} 列`,
      );
    }

    const valuesByHeader = Object.fromEntries(
      headers.map((header, valueIndex) => [header, values[valueIndex].trim()]),
    ) as Record<string, string>;

    const emptyFields = REQUIRED_VALUES.filter((field) => valuesByHeader[field] === '');
    if (emptyFields.length > 0) {
      throw new DataValidationError(`CSV 第 ${rowNumber} 行缺少必要字段: ${emptyFields.join(', ')}`);
    }

    return Object.fromEntries(
      REQUIRED_HEADERS.map((header) => [header, valuesByHeader[header]]),
    ) as unknown as RawStudent;
  });
}

export function parseAdcodeMap(value: unknown, resourceName: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataValidationError(`${resourceName} 必须是对象`);
  }

  const entries = Object.entries(value);
  for (const [name, adcode] of entries) {
    if (name.trim() === '' || typeof adcode !== 'string' || !/^\d{6}$/.test(adcode)) {
      throw new DataValidationError(`${resourceName} 包含无效的行政区映射: ${name}`);
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

export function parseMiddleSchoolInfo(
  value: unknown,
  resourceName: string,
): MiddleSchoolInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataValidationError(`${resourceName} 必须是对象`);
  }
  const record = value as Record<string, unknown>;
  const textFields = ['name', 'province', 'city', 'address'] as const;
  const textValues = Object.fromEntries(textFields.map((field) => {
    const fieldValue = record[field];
    if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
      throw new DataValidationError(`${resourceName} 的 ${field} 无效`);
    }
    return [field, fieldValue.trim()];
  })) as Pick<MiddleSchoolInfo, typeof textFields[number]>;
  const lat = record.lat;
  const lng = record.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new DataValidationError(`${resourceName} 的 lat 无效`);
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new DataValidationError(`${resourceName} 的 lng 无效`);
  }
  const parseAssetPath = (field: 'title_img' | 'title_img_dark'): string | undefined => {
    const fieldValue = record[field];
    if (fieldValue === undefined) return undefined;
    const normalizedValue = typeof fieldValue === 'string' ? fieldValue.trim() : '';
    if (
      normalizedValue === '' ||
      normalizedValue.startsWith('/') ||
      normalizedValue.includes('\\') ||
      normalizedValue.split('/').includes('..') ||
      /^[a-z][a-z\d+.-]*:/i.test(normalizedValue)
    ) {
      throw new DataValidationError(`${resourceName} 的 ${field} 必须是 data 目录内的相对路径`);
    }
    return normalizedValue;
  };
  const titleImg = parseAssetPath('title_img');
  const titleImgDark = parseAssetPath('title_img_dark');
  return {
    ...textValues,
    lat,
    lng,
    ...(titleImg ? { titleImg } : {}),
    ...(titleImgDark ? { titleImgDark } : {}),
  };
}

function parseCoordinate(rawValue: string, field: 'lat' | 'lng', rowNumber: number): number | null {
  if (rawValue === '') return null;

  const value = Number(rawValue);
  const minimum = field === 'lat' ? -90 : -180;
  const maximum = field === 'lat' ? 90 : 180;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DataValidationError(`CSV 第 ${rowNumber} 行 ${field} 坐标无效: ${rawValue}`);
  }

  return value;
}

function appendIndex(index: Map<string, SchoolGroup[]>, key: string | null, school: SchoolGroup): void {
  if (!key) return;
  const schools = index.get(key) ?? [];
  schools.push(school);
  index.set(key, schools);
}

export function processStudentData(
  rawStudents: RawStudent[],
  provinceAdcodeMap: ProvinceAdcodeMap,
  cityAdcodeMap: CityAdcodeMap,
  middleSchool: MiddleSchoolInfo | null = null,
): ProcessedData {
  const students: Student[] = rawStudents.map((raw, index) => {
    const rowNumber = index + 2;
    const parsedNo = Number(raw.no);
    if (!Number.isInteger(parsedNo)) {
      throw new DataValidationError(`CSV 第 ${rowNumber} 行 no 必须是整数: ${raw.no}`);
    }

    const lat = parseCoordinate(raw.lat, 'lat', rowNumber);
    const lng = parseCoordinate(raw.lng, 'lng', rowNumber);
    if ((lat === null) !== (lng === null)) {
      throw new DataValidationError(`CSV 第 ${rowNumber} 行经纬度必须同时填写或同时留空`);
    }

    return {
      no: parsedNo,
      rawNo: raw.no,
      name: raw.name,
      short: raw.short,
      university: raw.university,
      province: raw.province,
      city: raw.city,
      contact: raw.contact && raw.contact.trim() !== '' ? raw.contact.trim() : null,
      lat,
      lng,
      originalIndex: index,
    };
  });

  const schoolMap = new Map<string, Student[]>();
  for (const student of students) {
    if (!schoolMap.has(student.university)) {
      schoolMap.set(student.university, []);
    }
    schoolMap.get(student.university)!.push(student);
  }

  const schools: SchoolGroup[] = [];

  for (const [university, studentList] of schoolMap.entries()) {
    const sortedStudents = [...studentList].sort((a, b) => {
      if (a.no !== b.no) {
        return a.no - b.no;
      }
      return a.originalIndex - b.originalIndex;
    });

    const sample = sortedStudents[0];
    const provinceAdcode = provinceAdcodeMap[sample.province] || null;
    const isForeign = provinceAdcode === null;

    if (!isForeign && (sample.lat === null || sample.lng === null)) {
      throw new DataValidationError(`国内学校缺少经纬度: ${university}`);
    }

    for (const student of sortedStudents.slice(1)) {
      if (
        student.province !== sample.province ||
        student.city !== sample.city ||
        student.lat !== sample.lat ||
        student.lng !== sample.lng
      ) {
        throw new DataValidationError(`同一学校的地区或坐标不一致: ${university}`);
      }
    }

    let cityAdcode: string | null = null;
    if (!isForeign) {
      cityAdcode = cityAdcodeMap[sample.city] || provinceAdcode;
    }

    schools.push({
      university,
      province: sample.province,
      city: sample.city,
      provinceAdcode,
      cityAdcode,
      lat: sample.lat,
      lng: sample.lng,
      isForeign,
      students: sortedStudents,
    });
  }

  const domesticSchools = schools.filter((s) => !s.isForeign);
  const foreignSchools = schools.filter((s) => s.isForeign);
  const schoolByUniversity = new Map<string, SchoolGroup>();
  const schoolByStudent = new Map<Student, SchoolGroup>();
  const schoolsByProvinceAdcode = new Map<string, SchoolGroup[]>();
  const schoolsByCityAdcode = new Map<string, SchoolGroup[]>();

  for (const school of schools) {
    schoolByUniversity.set(school.university, school);
    appendIndex(schoolsByProvinceAdcode, school.provinceAdcode, school);
    appendIndex(schoolsByCityAdcode, school.cityAdcode, school);
    for (const student of school.students) {
      schoolByStudent.set(student, school);
    }
  }

  return {
    middleSchool,
    students,
    schools,
    domesticSchools,
    foreignSchools,
    indexes: {
      schoolByUniversity,
      schoolByStudent,
      schoolsByProvinceAdcode,
      schoolsByCityAdcode,
    },
  };
}
