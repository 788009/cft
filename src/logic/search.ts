import type { Student, SchoolGroup } from '@/types';

export function normalizeSearchText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

export type SearchField = 'name' | 'short' | 'university' | 'province' | 'city';

interface SearchIndexEntry {
  value: string;
  normalizedValue: string;
  fields: SearchField[];
  students: Set<Student>;
  schools: Set<SchoolGroup>;
  targetSchools: Set<SchoolGroup>;
  order: number;
}

export interface SearchIndex {
  entries: readonly SearchIndexEntry[];
  byNormalizedValue: ReadonlyMap<string, SearchIndexEntry>;
}

export interface SearchSuggestion {
  value: string;
  normalizedValue: string;
  fields: readonly SearchField[];
}

export interface SearchResult {
  matchedStudents: Set<Student>;
  matchedSchools: Set<SchoolGroup>;
  targetSchools: Set<SchoolGroup>;
}

export function createSearchIndex(
  students: Student[],
  schools: SchoolGroup[],
): SearchIndex {
  const byNormalizedValue = new Map<string, SearchIndexEntry>();
  const schoolByUniversity = new Map(schools.map((school) => [school.university, school]));
  let nextOrder = 0;

  const getEntry = (value: string, field: SearchField): SearchIndexEntry | null => {
    const normalizedValue = normalizeSearchText(value);
    if (!normalizedValue) return null;

    const existing = byNormalizedValue.get(normalizedValue);
    if (existing) {
      if (!existing.fields.includes(field)) existing.fields.push(field);
      return existing;
    }

    const entry: SearchIndexEntry = {
      value,
      normalizedValue,
      fields: [field],
      students: new Set(),
      schools: new Set(),
      targetSchools: new Set(),
      order: nextOrder,
    };
    nextOrder += 1;
    byNormalizedValue.set(normalizedValue, entry);
    return entry;
  };

  const addStudentField = (field: 'name' | 'short'): void => {
    for (const student of students) {
      const entry = getEntry(student[field], field);
      if (!entry) continue;
      entry.students.add(student);
      const school = schoolByUniversity.get(student.university);
      if (school) entry.targetSchools.add(school);
    }
  };
  const addSchoolField = (field: 'university' | 'province' | 'city'): void => {
    for (const school of schools) {
      const entry = getEntry(school[field], field);
      if (!entry) continue;
      entry.schools.add(school);
      entry.targetSchools.add(school);
    }
  };

  addStudentField('name');
  addStudentField('short');
  addSchoolField('university');
  addSchoolField('province');
  addSchoolField('city');

  return {
    entries: Array.from(byNormalizedValue.values()),
    byNormalizedValue,
  };
}

export function executeSearch(query: string, index: SearchIndex): SearchResult {
  const normalizedQuery = normalizeSearchText(query);
  const entry = normalizedQuery ? index.byNormalizedValue.get(normalizedQuery) : undefined;
  return {
    matchedStudents: new Set(entry?.students),
    matchedSchools: new Set(entry?.schools),
    targetSchools: new Set(entry?.targetSchools),
  };
}

export function getSearchSuggestions(
  query: string,
  index: SearchIndex,
  limit: number,
): SearchSuggestion[] {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (!normalizedQuery || normalizedLimit === 0) return [];

  return index.entries
    .filter((entry) => entry.normalizedValue.includes(normalizedQuery))
    .sort((left, right) => {
      const leftExact = left.normalizedValue === normalizedQuery ? 1 : 0;
      const rightExact = right.normalizedValue === normalizedQuery ? 1 : 0;
      return rightExact - leftExact || left.order - right.order;
    })
    .slice(0, normalizedLimit)
    .map((entry) => ({
      value: entry.value,
      normalizedValue: entry.normalizedValue,
      fields: [...entry.fields],
    }));
}
