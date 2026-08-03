import { describe, it, expect } from 'vitest';
import { parseCsv, processStudentData } from '../parser';
import type { RawStudent, ProvinceAdcodeMap, CityAdcodeMap } from '@/types';

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
});
