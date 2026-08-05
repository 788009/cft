import { describe, it, expect } from 'vitest';
import {
  DataValidationError,
  parseAdcodeMap,
  parseCsv,
  parseMiddleSchoolInfo,
  processStudentData,
} from '../parser';
import type { RawStudent, ProvinceAdcodeMap, CityAdcodeMap } from '@/types';
import realCsv from '../../../data/data.csv?raw';
import realProvinceMap from '../../../data/province2adcode.json?raw';
import realCityMap from '../../../data/cities2adcode.json?raw';

describe('Data Parser Module', () => {
  it('should parse CSV content correctly', () => {
    const csvContent = `no,name,short,university,province,city,contact,lat,lng
1,Z三,ZS,清华大学,北京市,北京市,13800000000,39.999,116.326
2,L四,LS,清华大学,北京市,北京市,,39.999,116.326`;

    const raw = parseCsv(csvContent);
    expect(raw).toHaveLength(2);
    expect(raw[0].university).toBe('清华大学');
    expect(raw[1].contact).toBe('');
  });

  it('should parse quoted commas, escaped quotes and line breaks', () => {
    const csvContent = `no,name,short,university,province,city,contact,lat,lng
1,A,AA,"University, Campus",Province,City,"line 1
line ""2""",30,120`;

    const [record] = parseCsv(csvContent);
    expect(record.university).toBe('University, Campus');
    expect(record.contact).toBe('line 1\nline "2"');
  });

  it('should reject missing headers and incomplete rows', () => {
    expect(() => parseCsv('no,name\n1,A')).toThrowError(/缺少必要表头/);
    expect(() => parseCsv(`no,name,short,university,province,city,contact,lat,lng
1,A,AA,U,P,C,,30`)).toThrowError(/列数错误/);
  });

  it('should validate adcode maps', () => {
    expect(parseAdcodeMap({ Province: '110000' }, 'map.json')).toEqual({ Province: '110000' });
    expect(() => parseAdcodeMap({ Province: 'invalid' }, 'map.json')).toThrow(DataValidationError);
  });

  it('should validate and normalize middle school information', () => {
    expect(parseMiddleSchoolInfo({
      name: ' 测试中学 ',
      province: '测试省',
      city: '测试市',
      lat: 30,
      lng: 120,
    }, 'middle_school_info.json')).toEqual({
      name: '测试中学',
      province: '测试省',
      city: '测试市',
      lat: 30,
      lng: 120,
    });
    expect(() => parseMiddleSchoolInfo({
      name: '测试中学', province: '测试省', city: '测试市', lat: 91, lng: 120,
    }, 'middle_school_info.json')).toThrow(/lat 无效/);
  });

  it('should group by university and sort students by no while preserving original order on ties', () => {
    const rawStudents: RawStudent[] = [
      { no: '10', name: 'B', short: 'B', university: 'U1', province: '浙江省', city: '杭州市', contact: '', lat: '30.0', lng: '120.0' },
      { no: '2', name: 'A', short: 'A', university: 'U1', province: '浙江省', city: '杭州市', contact: '', lat: '30.0', lng: '120.0' },
      { no: '2', name: 'C', short: 'C', university: 'U1', province: '浙江省', city: '杭州市', contact: '', lat: '30.0', lng: '120.0' },
    ];

    const provinceMap: ProvinceAdcodeMap = { '浙江省': '330000' };
    const cityMap: CityAdcodeMap = { '杭州市': '330100' };

    const result = processStudentData(rawStudents, provinceMap, cityMap);
    expect(result.schools).toHaveLength(1);

    const u1Students = result.schools[0].students;
    expect(u1Students.map((s) => s.name)).toEqual(['A', 'C', 'B']);
    expect(result.indexes.schoolByUniversity.get('U1')).toBe(result.schools[0]);
    expect(result.indexes.schoolByStudent.get(u1Students[0])).toBe(result.schools[0]);
    expect(result.indexes.schoolsByCityAdcode.get('330100')).toEqual([result.schools[0]]);
  });

  it('should correctly identify foreign schools and handle municipality city adcode fallback', () => {
    const rawStudents: RawStudent[] = [
      { no: '1', name: 'D', short: 'D', university: '哈佛大学', province: '麻省', city: '剑桥', contact: '', lat: '', lng: '' },
      { no: '1', name: 'E', short: 'E', university: '北京大学', province: '北京市', city: '北京市', contact: '', lat: '39.9', lng: '116.3' },
    ];

    const provinceMap: ProvinceAdcodeMap = { '北京市': '110000' };
    const cityMap: CityAdcodeMap = {}; // 直辖市 city adcode 不存在于 cityMap 中

    const result = processStudentData(rawStudents, provinceMap, cityMap);

    expect(result.foreignSchools).toHaveLength(1);
    expect(result.foreignSchools[0].university).toBe('哈佛大学');
    expect(result.foreignSchools[0].isForeign).toBe(true);

    expect(result.domesticSchools).toHaveLength(1);
    expect(result.domesticSchools[0].university).toBe('北京大学');
    expect(result.domesticSchools[0].cityAdcode).toBe('110000'); // 回退使用省份 adcode
  });

  it('should reject invalid numbers, partial coordinates and inconsistent school data', () => {
    const base: RawStudent = {
      no: '1', name: 'A', short: 'A', university: 'U', province: 'P', city: 'C',
      contact: '', lat: '30', lng: '120',
    };
    const provinceMap = { P: '110000' };

    expect(() => processStudentData([{ ...base, no: '1.5' }], provinceMap, {})).toThrow(/no 必须是整数/);
    expect(() => processStudentData([{ ...base, lng: '' }], provinceMap, {})).toThrow(/同时填写/);
    expect(() => processStudentData([
      base,
      { ...base, no: '2', city: 'Other' },
    ], provinceMap, {})).toThrow(/地区或坐标不一致/);
  });

  it('should parse and process the existing data assets', () => {
    const provinceMap = parseAdcodeMap(JSON.parse(realProvinceMap), 'province2adcode.json');
    const cityMap = parseAdcodeMap(JSON.parse(realCityMap), 'cities2adcode.json');
    const result = processStudentData(parseCsv(realCsv), provinceMap, cityMap);

    expect(result.students.length).toBeGreaterThan(0);
    expect(result.schools.length).toBeGreaterThan(0);
    expect(result.domesticSchools.every((school) => school.lat !== null && school.lng !== null)).toBe(true);
    expect(result.indexes.schoolByUniversity.size).toBe(result.schools.length);
  });
});
