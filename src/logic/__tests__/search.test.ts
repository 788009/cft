import { describe, it, expect } from 'vitest';
import { normalizeSearchText, executeSearch } from '../search';
import type { Student, SchoolGroup } from '@/types';

describe('Search Logic', () => {
  it('should normalize search text by removing whitespace and converting to lowercase', () => {
    expect(normalizeSearchText('  HeLLo  W o R l D ')).toBe('helloworld');
  });

  it('should perform strict match on students and schools', () => {
    const students = [
      { name: '张三', short: 'zs' },
      { name: '李四', short: 'ls' },
    ] as Student[];

    const schools = [
      { university: '清华大学', province: '北京市', city: '北京市' },
      { university: '浙江大学', province: '浙江省', city: '杭州市' },
    ] as SchoolGroup[];

    const res1 = executeSearch(' Z s ', students, schools);
    expect(res1.matchedStudents.size).toBe(1);
    expect(res1.matchedSchools.size).toBe(0);

    const res2 = executeSearch('浙江省', students, schools);
    expect(res2.matchedStudents.size).toBe(0);
    expect(res2.matchedSchools.size).toBe(1);
  });
});
