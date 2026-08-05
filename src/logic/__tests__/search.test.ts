import { describe, it, expect } from 'vitest';
import {
  createSearchIndex,
  executeSearch,
  getSearchSuggestions,
  normalizeSearchText,
} from '../search';
import type { Student, SchoolGroup } from '@/types';

describe('Search Logic', () => {
  it('should normalize search text by removing whitespace and converting to lowercase', () => {
    expect(normalizeSearchText(' \n HeLLo\u00a0 W o R l D\t')).toBe('helloworld');
  });

  const students = [
    { name: '张三', short: 'zs', university: '清华大学' },
    { name: '张四', short: 'zs', university: '北京大学' },
    { name: '李四', short: 'ls', university: '浙江大学' },
  ] as Student[];
  const schools = [
    { university: '清华大学', province: '北京市', city: '北京市' },
    { university: '北京大学', province: '北京市', city: '北京市' },
    { university: '浙江大学', province: '浙江省', city: '杭州市' },
  ] as SchoolGroup[];

  it('performs strict matching and preserves one-to-many results', () => {
    const index = createSearchIndex(students, schools);
    const studentResult = executeSearch(' Z s ', index);
    expect(Array.from(studentResult.matchedStudents, (student) => student.name))
      .toEqual(['张三', '张四']);
    expect(studentResult.matchedSchools.size).toBe(0);
    expect(Array.from(studentResult.targetSchools, (school) => school.university))
      .toEqual(['清华大学', '北京大学']);

    const provinceResult = executeSearch('北京市', index);
    expect(provinceResult.matchedStudents.size).toBe(0);
    expect(Array.from(provinceResult.matchedSchools, (school) => school.university))
      .toEqual(['清华大学', '北京大学']);
    expect(executeSearch('清华', index).matchedSchools.size).toBe(0);
  });

  it('clears all matches for an empty normalized query', () => {
    const result = executeSearch(' \n\t ', createSearchIndex(students, schools));
    expect(result.matchedStudents.size).toBe(0);
    expect(result.matchedSchools.size).toBe(0);
    expect(result.targetSchools.size).toBe(0);
  });

  it('returns deterministic contains suggestions and merges duplicate values', () => {
    const index = createSearchIndex(students, schools);
    const suggestions = getSearchSuggestions('北京', index, 10);

    expect(suggestions.map((suggestion) => suggestion.value)).toEqual([
      '北京大学',
      '北京市',
    ]);
    expect(suggestions[1].fields).toEqual(['province', 'city']);
  });

  it('places exact suggestions first and respects the result limit', () => {
    const index = createSearchIndex(students, schools);
    expect(getSearchSuggestions('zs', index, 1)).toEqual([{
      value: 'zs',
      normalizedValue: 'zs',
      fields: ['short'],
    }]);
    expect(getSearchSuggestions('大学', index, 2).map((suggestion) => suggestion.value))
      .toEqual(['清华大学', '北京大学']);
    expect(getSearchSuggestions('', index, 10)).toEqual([]);
    expect(getSearchSuggestions('大学', index, 0)).toEqual([]);
  });
});
