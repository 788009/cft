import type { Student, SchoolGroup } from '@/types';

export function normalizeSearchText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

export interface SearchResult {
  matchedStudents: Set<Student>;
  matchedSchools: Set<SchoolGroup>;
}

export function executeSearch(
  query: string,
  students: Student[],
  schools: SchoolGroup[]
): SearchResult {
  const result: SearchResult = {
    matchedStudents: new Set(),
    matchedSchools: new Set(),
  };

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return result;
  }

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    if (
      normalizeSearchText(student.name) === normalizedQuery ||
      normalizeSearchText(student.short) === normalizedQuery
    ) {
      result.matchedStudents.add(student);
    }
  }

  for (let i = 0; i < schools.length; i++) {
    const school = schools[i];
    if (
      normalizeSearchText(school.university) === normalizedQuery ||
      normalizeSearchText(school.province) === normalizedQuery ||
      normalizeSearchText(school.city) === normalizedQuery
    ) {
      result.matchedSchools.add(school);
    }
  }

  return result;
}
