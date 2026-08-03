import { describe, expect, it } from 'vitest';
import { getPersonDetailRows } from '../person';
import type { Student } from '@/types';

function createStudent(contact: string | null): Student {
  return {
    no: 1,
    rawNo: '1',
    name: '测试姓名',
    short: 'csxm',
    university: '测试大学',
    province: '测试省份',
    city: '测试城市',
    contact,
    lat: 0,
    lng: 0,
    originalIndex: 0,
  };
}

describe('getPersonDetailRows', () => {
  it('includes a non-empty contact value', () => {
    expect(getPersonDetailRows(createStudent('contact-value'))).toEqual([
      { key: 'university', label: '大学', value: '测试大学' },
      { key: 'province', label: '省份', value: '测试省份' },
      { key: 'city', label: '城市', value: '测试城市' },
      { key: 'contact', label: '联系方式', value: 'contact-value' },
    ]);
  });

  it('omits the entire contact row when contact is absent', () => {
    const rows = getPersonDetailRows(createStudent(null));
    expect(rows.map((row) => row.key)).toEqual(['university', 'province', 'city']);
    expect(rows).not.toContainEqual(expect.objectContaining({ key: 'contact' }));
  });
});
